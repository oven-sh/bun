// Expressions: each function reads the tokens that the parse function of the same name of the reference reads, and asks Bun's tree where that one decides by lookahead.
use super::declarations::method_function;
use super::{Lowerer, Lowering, token_is_identifier_or_keyword};
use crate::ast::{
    Kind, ModifierListId, NodeFactory, NodeFlags, NodeId, NodeListId, TokenFlags,
    is_assignment_operator,
};
use crate::diagnostics;
use bun_ast::{E, Expr, ExprData, G, OpCode, StmtData};

// The operand that an expression starts with: its first token is the first token of that operand.
fn left_operand(expr: &Expr) -> Option<&Expr> {
    match &expr.data {
        ExprData::EBinary(e) => Some(&e.left),
        ExprData::EDot(e) => Some(&e.target),
        ExprData::EIndex(e) => Some(&e.target),
        ExprData::ECall(e) => Some(&e.target),
        ExprData::EIf(e) => Some(&e.test),
        ExprData::EUnary(e) if matches!(e.op, OpCode::UnPostDec | OpCode::UnPostInc) => {
            Some(&e.value)
        }
        ExprData::ETemplate(e) => e.tag.as_ref(),
        _ => None,
    }
}

// The token of a binary operator of Bun's tree.
fn binary_operator_kind(op: OpCode) -> Kind {
    match op {
        OpCode::BinAdd => Kind::PlusToken,
        OpCode::BinSub => Kind::MinusToken,
        OpCode::BinMul => Kind::AsteriskToken,
        OpCode::BinDiv => Kind::SlashToken,
        OpCode::BinRem => Kind::PercentToken,
        OpCode::BinPow => Kind::AsteriskAsteriskToken,
        OpCode::BinLt => Kind::LessThanToken,
        OpCode::BinLe => Kind::LessThanEqualsToken,
        OpCode::BinGt => Kind::GreaterThanToken,
        OpCode::BinGe => Kind::GreaterThanEqualsToken,
        OpCode::BinIn => Kind::InKeyword,
        OpCode::BinInstanceof => Kind::InstanceOfKeyword,
        OpCode::BinShl => Kind::LessThanLessThanToken,
        OpCode::BinShr => Kind::GreaterThanGreaterThanToken,
        OpCode::BinUShr => Kind::GreaterThanGreaterThanGreaterThanToken,
        OpCode::BinLooseEq => Kind::EqualsEqualsToken,
        OpCode::BinLooseNe => Kind::ExclamationEqualsToken,
        OpCode::BinStrictEq => Kind::EqualsEqualsEqualsToken,
        OpCode::BinStrictNe => Kind::ExclamationEqualsEqualsToken,
        OpCode::BinNullishCoalescing => Kind::QuestionQuestionToken,
        OpCode::BinLogicalOr => Kind::BarBarToken,
        OpCode::BinLogicalAnd => Kind::AmpersandAmpersandToken,
        OpCode::BinBitwiseOr => Kind::BarToken,
        OpCode::BinBitwiseAnd => Kind::AmpersandToken,
        OpCode::BinBitwiseXor => Kind::CaretToken,
        OpCode::BinComma => Kind::CommaToken,
        OpCode::BinAssign => Kind::EqualsToken,
        OpCode::BinAddAssign => Kind::PlusEqualsToken,
        OpCode::BinSubAssign => Kind::MinusEqualsToken,
        OpCode::BinMulAssign => Kind::AsteriskEqualsToken,
        OpCode::BinDivAssign => Kind::SlashEqualsToken,
        OpCode::BinRemAssign => Kind::PercentEqualsToken,
        OpCode::BinPowAssign => Kind::AsteriskAsteriskEqualsToken,
        OpCode::BinShlAssign => Kind::LessThanLessThanEqualsToken,
        OpCode::BinShrAssign => Kind::GreaterThanGreaterThanEqualsToken,
        OpCode::BinUShrAssign => Kind::GreaterThanGreaterThanGreaterThanEqualsToken,
        OpCode::BinBitwiseOrAssign => Kind::BarEqualsToken,
        OpCode::BinBitwiseAndAssign => Kind::AmpersandEqualsToken,
        OpCode::BinBitwiseXorAssign => Kind::CaretEqualsToken,
        OpCode::BinNullishCoalescingAssign => Kind::QuestionQuestionEqualsToken,
        OpCode::BinLogicalOrAssign => Kind::BarBarEqualsToken,
        OpCode::BinLogicalAndAssign => Kind::AmpersandAmpersandEqualsToken,
        OpCode::UnPos
        | OpCode::UnNeg
        | OpCode::UnCpl
        | OpCode::UnNot
        | OpCode::UnVoid
        | OpCode::UnTypeof
        | OpCode::UnDelete
        | OpCode::UnPreDec
        | OpCode::UnPreInc
        | OpCode::UnPostDec
        | OpCode::UnPostInc => Kind::Unknown,
    }
}

// ast.IsLeftHandSideExpression, by the kind of a node that the lowering makes.
fn is_left_hand_side_expression_kind(kind: Kind) -> bool {
    matches!(
        kind,
        Kind::PropertyAccessExpression
            | Kind::ElementAccessExpression
            | Kind::NewExpression
            | Kind::CallExpression
            | Kind::TaggedTemplateExpression
            | Kind::ArrayLiteralExpression
            | Kind::ParenthesizedExpression
            | Kind::ObjectLiteralExpression
            | Kind::ClassExpression
            | Kind::FunctionExpression
            | Kind::Identifier
            | Kind::PrivateIdentifier
            | Kind::RegularExpressionLiteral
            | Kind::NumericLiteral
            | Kind::BigIntLiteral
            | Kind::StringLiteral
            | Kind::NoSubstitutionTemplateLiteral
            | Kind::TemplateExpression
            | Kind::FalseKeyword
            | Kind::NullKeyword
            | Kind::ThisKeyword
            | Kind::TrueKeyword
            | Kind::SuperKeyword
            | Kind::MetaProperty
            | Kind::ImportKeyword
    )
}

impl<'t> Lowerer<'t, '_> {
    // parseExpression: clear the decorator context when parsing Expression, as it should be unambiguous when parsing a decorator
    pub(super) fn lower_expression(&mut self, expr: &'t Expr) -> Lowering<NodeId> {
        let save_context_flags = self.context_flags;
        self.context_flags = self.context_flags.without(NodeFlags::DECORATOR_CONTEXT);
        let node = self.lower_assignment_expression(expr);
        self.context_flags = save_context_flags;
        node
    }

    // parseExpressionAllowIn
    pub(super) fn lower_expression_allow_in(&mut self, expr: &'t Expr) -> Lowering<NodeId> {
        let save_context_flags = self.context_flags;
        self.set_context_flags(NodeFlags::DISALLOW_IN_CONTEXT, false);
        let node = self.lower_expression(expr);
        self.context_flags = save_context_flags;
        node
    }

    // parseAssignmentExpressionOrHigher: the chain of left operands is walked up from its first token, so its depth costs no stack.
    pub(super) fn lower_assignment_expression(&mut self, expr: &'t Expr) -> Lowering<NodeId> {
        self.check_stack()?;
        if self.token != Kind::OpenParenToken && left_operand(expr).is_none() {
            return self.lower_leaf(expr);
        }
        let mut chain: Vec<&'t Expr> = Vec::new();
        let mut leaf = expr;
        while let Some(left) = left_operand(leaf) {
            chain.push(leaf);
            leaf = left;
        }

        // parseParenthesizedExpression reads what is inside with parseExpressionAllowIn. Bun's tree has no node for it.
        let outer_flags = self.context_flags;
        let inner_flags =
            outer_flags.without(NodeFlags::DISALLOW_IN_CONTEXT | NodeFlags::DECORATOR_CONTEXT);
        let mut parens: Vec<(i32, u8)> = Vec::new();
        while self.token == Kind::OpenParenToken && !self.is_parameter_list_of(leaf) {
            parens.push((self.node_pos(), self.jsdoc_scanner_info()));
            self.next_token();
            self.context_flags = inner_flags;
        }

        let mut pos = self.node_pos();
        let mut node = self.lower_leaf(leaf)?;
        self.close_parentheses(&mut parens, &mut node, &mut pos, outer_flags, inner_flags);
        while let Some(parent) = chain.pop() {
            node = self.lower_rest(parent, node, pos)?;
            self.close_parentheses(&mut parens, &mut node, &mut pos, outer_flags, inner_flags);
        }
        if !parens.is_empty() {
            return Err(self.out_of_step("a parenthesis that no operand of the tree closes"));
        }
        Ok(node)
    }

    // The `(` that the lowering is at opens the parameters of the arrow function `leaf`: Bun puts an arrow function at that token.
    fn is_parameter_list_of(&self, leaf: &Expr) -> bool {
        matches!(leaf.data, ExprData::EArrow(_)) && leaf.loc.start == self.scanner.token_start()
    }

    // A `)` after an operand closes the innermost parenthesis that is open: the operand is what it holds.
    fn close_parentheses(
        &mut self,
        parens: &mut Vec<(i32, u8)>,
        node: &mut NodeId,
        pos: &mut i32,
        outer_flags: NodeFlags,
        inner_flags: NodeFlags,
    ) {
        while self.token == Kind::CloseParenToken {
            let Some((paren_pos, jsdoc)) = parens.pop() else {
                break;
            };
            self.next_token();
            self.context_flags = if parens.is_empty() {
                outer_flags
            } else {
                inner_flags
            };
            let result = self.b.new_parenthesized_expression(*node);
            self.finish(result, paren_pos);
            self.with_jsdoc(result, jsdoc);
            *node = result;
            *pos = paren_pos;
        }
    }

    // What follows the left operand `left` of `expr`: parseBinaryExpressionRest, parseConditionalExpressionRest, parseMemberExpressionRest, parseCallExpressionRest.
    fn lower_rest(&mut self, expr: &'t Expr, left: NodeId, pos: i32) -> Lowering<NodeId> {
        // parseMemberExpressionRest, parseCallExpressionRest and the postfix half of parseUpdateExpression go on after a left-hand side expression only: Bun's parse goes on after a postfix operator too.
        if !matches!(expr.data, ExprData::EBinary(_) | ExprData::EIf(_))
            && !is_left_hand_side_expression_kind(self.b.kind(left))
        {
            return Err(self.out_of_step(
                "a member, a call or a postfix operator after what the reference does not go on from",
            ));
        }
        match &expr.data {
            ExprData::EBinary(e) => {
                if matches!(
                    self.token,
                    Kind::LessThanToken | Kind::LessThanLessThanToken
                ) && self.reference_may_read_type_arguments()
                {
                    return Err(self.unsupported(
                        "type arguments after an expression, where a JavaScript parse has an operator",
                    ));
                }
                // We call reScanGreaterToken so that we merge token sequences like > and = into >=
                let operator = binary_operator_kind(e.op);
                if self.re_scan_greater_than_token() != operator {
                    return Err(
                        self.out_of_step("a binary operator of the tree is not at its place")
                    );
                }
                // parseAssignmentExpressionOrHigher reads an assignment after a left-hand side expression only: Bun's parse takes any target.
                if is_assignment_operator(operator)
                    && !is_left_hand_side_expression_kind(self.b.kind(left))
                {
                    return Err(self.out_of_step(
                        "an assignment to what the reference does not read as a target",
                    ));
                }
                let operator_token = self.parse_token_node();
                let right = self.lower_assignment_expression(&e.right)?;
                let node = self.b.new_binary_expression(
                    ModifierListId::NIL,
                    left,
                    NodeId::NIL,
                    operator_token,
                    right,
                );
                Ok(self.finish(node, pos))
            }
            ExprData::EIf(e) => {
                let question_token = self.expect_token_node(Kind::QuestionToken)?;
                // Note: we explicitly 'allowIn' in the whenTrue part of the condition expression, and we do not that for the 'whenFalse' part.
                let save_context_flags = self.context_flags;
                self.set_context_flags(NodeFlags::DISALLOW_IN_CONTEXT, false);
                let true_expression = self.lower_assignment_expression(&e.yes);
                self.context_flags = save_context_flags;
                let true_expression = true_expression?;
                let colon_token = self.expect_token_node(Kind::ColonToken)?;
                let false_expression = self.lower_assignment_expression(&e.no)?;
                let node = self.b.new_conditional_expression(
                    left,
                    question_token,
                    true_expression,
                    colon_token,
                    false_expression,
                );
                Ok(self.finish(node, pos))
            }
            ExprData::EUnary(e) => {
                let operator = if e.op == OpCode::UnPostInc {
                    Kind::PlusPlusToken
                } else {
                    Kind::MinusMinusToken
                };
                if self.token != operator || self.has_preceding_line_break() {
                    return Err(
                        self.out_of_step("a postfix operator of the tree is not at its place")
                    );
                }
                self.next_token();
                let node = self.b.new_postfix_unary_expression(left, operator);
                Ok(self.finish(node, pos))
            }
            ExprData::EDot(_) => self.lower_property_access_rest(left, pos),
            ExprData::EIndex(e) => {
                // Bun keeps `a.#b` as an index whose key is the private name.
                if matches!(e.index.data, ExprData::EPrivateIdentifier(_)) {
                    return self.lower_property_access_rest(left, pos);
                }
                let question_dot_token = self.optional_token_node(Kind::QuestionDotToken);
                self.expect(Kind::OpenBracketToken)?;
                let argument_expression = self.lower_expression_allow_in(&e.index)?;
                self.expect(Kind::CloseBracketToken)?;
                let flags = self.optional_chain_flags(left, question_dot_token);
                let node = self.b.new_element_access_expression(
                    left,
                    question_dot_token,
                    argument_expression,
                    flags,
                );
                Ok(self.finish(node, pos))
            }
            ExprData::ECall(e) => {
                let question_dot_token = self.optional_token_node(Kind::QuestionDotToken);
                let argument_list = self.lower_argument_list(e.args.as_slice())?;
                let flags = self.optional_chain_flags(left, question_dot_token);
                let node = self.b.new_call_expression(
                    left,
                    question_dot_token,
                    NodeListId::NIL,
                    argument_list,
                    flags,
                );
                Ok(self.finish(node, pos))
            }
            ExprData::ETemplate(e) => {
                // parseTaggedTemplateRest
                let template = if self.token == Kind::NoSubstitutionTemplateLiteral {
                    self.re_scan_template_token(true);
                    self.parse_literal_expression()?
                } else {
                    self.lower_template_expression(e, true)?
                };
                let flags = self.b.flags(left) & NodeFlags::OPTIONAL_CHAIN;
                let node = self.b.new_tagged_template_expression(
                    left,
                    NodeId::NIL,
                    NodeListId::NIL,
                    template,
                    flags,
                );
                Ok(self.finish(node, pos))
            }
            _ => Err(self.unsupported("an operand chain of an unknown kind")),
        }
    }

    // isOptionalChain: a `?.` here, or tryReparseOptionalChain of the expression before it.
    fn optional_chain_flags(&self, expression: NodeId, question_dot_token: NodeId) -> NodeFlags {
        if !question_dot_token.is_nil()
            || self
                .b
                .flags(expression)
                .intersects(NodeFlags::OPTIONAL_CHAIN)
        {
            return NodeFlags::OPTIONAL_CHAIN;
        }
        NodeFlags::NONE
    }

    // parsePropertyAccessExpressionRest, from the `.` or the `?.`
    fn lower_property_access_rest(&mut self, expression: NodeId, pos: i32) -> Lowering<NodeId> {
        let question_dot_token = if self.token == Kind::QuestionDotToken {
            self.parse_token_node()
        } else {
            self.expect(Kind::DotToken)?;
            NodeId::NIL
        };
        // parseRightSideOfDot reports `name.` before a line that starts with two names: Bun reads a property access there and its tree is kept.
        if self.has_preceding_line_break()
            && token_is_identifier_or_keyword(self.token)
            && self.look_ahead(|this| {
                token_is_identifier_or_keyword(this.next_token())
                    && !this.has_preceding_line_break()
            })
        {
            let at = self.node_pos();
            self.parse_error_at(at, at, diagnostics::IDENTIFIER_EXPECTED, &[]);
        }
        let name_start = self.scanner.token_start();
        let is_private = self.token == Kind::PrivateIdentifier;
        let name = if is_private {
            self.parse_private_identifier()?
        } else {
            self.create_identifier()?
        };
        let flags = self.optional_chain_flags(expression, question_dot_token);
        if is_private && flags.intersects(NodeFlags::OPTIONAL_CHAIN) {
            let name_end = self.node_pos();
            self.parse_error_at(
                name_start,
                name_end,
                diagnostics::AN_OPTIONAL_CHAIN_CANNOT_CONTAIN_PRIVATE_IDENTIFIERS,
                &[],
            );
        }
        let node =
            self.b
                .new_property_access_expression(expression, question_dot_token, name, flags);
        Ok(self.finish(node, pos))
    }

    // parseArgumentList
    fn lower_argument_list(&mut self, args: &'t [Expr]) -> Lowering<NodeListId> {
        self.expect(Kind::OpenParenToken)?;
        let result = self.lower_delimited(args, Some(Kind::CloseParenToken), |this, arg| {
            this.lower_argument_expression(arg)
        })?;
        self.expect(Kind::CloseParenToken)?;
        Ok(result)
    }

    // parseArgumentExpression
    fn lower_argument_expression(&mut self, expr: &'t Expr) -> Lowering<NodeId> {
        let save_context_flags = self.context_flags;
        self.set_context_flags(
            NodeFlags::DISALLOW_IN_CONTEXT | NodeFlags::DECORATOR_CONTEXT,
            false,
        );
        let node = self.lower_argument_or_array_literal_element(expr);
        self.context_flags = save_context_flags;
        node
    }

    // parseArgumentOrArrayLiteralElement
    fn lower_argument_or_array_literal_element(&mut self, expr: &'t Expr) -> Lowering<NodeId> {
        match &expr.data {
            ExprData::ESpread(e) => self.lower_spread_element(e),
            ExprData::EMissing(_) => {
                if self.token != Kind::CommaToken {
                    return Err(self.out_of_step("an omitted element of the tree has no comma"));
                }
                let node = self.b.new_omitted_expression();
                let pos = self.node_pos();
                Ok(self.finish(node, pos))
            }
            _ => self.lower_assignment_expression(expr),
        }
    }

    // parseSpreadElement
    fn lower_spread_element(&mut self, e: &'t E::Spread) -> Lowering<NodeId> {
        let pos = self.node_pos();
        self.expect(Kind::DotDotDotToken)?;
        let expression = self.lower_assignment_expression(&e.value)?;
        let node = self.b.new_spread_element(expression);
        Ok(self.finish(node, pos))
    }

    // An expression that starts with a token of its own: parsePrimaryExpression and the unary expressions.
    fn lower_leaf(&mut self, expr: &'t Expr) -> Lowering<NodeId> {
        match &expr.data {
            ExprData::EIdentifier(_) => self.create_identifier(),
            ExprData::ENumber(_) => self.lower_literal(Kind::NumericLiteral),
            ExprData::EBigInt(_) => self.lower_literal(Kind::BigIntLiteral),
            ExprData::EString(_) => {
                if self.token == Kind::NoSubstitutionTemplateLiteral {
                    if self
                        .scanner
                        .token_flags()
                        .intersects(TokenFlags::IS_INVALID)
                    {
                        self.re_scan_template_token(false);
                    }
                    return self.parse_literal_expression();
                }
                self.lower_literal(Kind::StringLiteral)
            }
            ExprData::ERegExp(_) => {
                if (self.token == Kind::SlashToken || self.token == Kind::SlashEqualsToken)
                    && self.re_scan_slash_token() == Kind::RegularExpressionLiteral
                {
                    return self.parse_literal_expression();
                }
                Err(self.out_of_step("a regular expression of the tree is not at its place"))
            }
            ExprData::EBoolean(e) => self.parse_keyword_expression(if e.value {
                Kind::TrueKeyword
            } else {
                Kind::FalseKeyword
            }),
            ExprData::ENull(_) => self.parse_keyword_expression(Kind::NullKeyword),
            ExprData::EThis(_) => self.parse_keyword_expression(Kind::ThisKeyword),
            ExprData::ESuper(_) => self.parse_keyword_expression(Kind::SuperKeyword),
            ExprData::EPrivateIdentifier(_) => self.parse_private_identifier(),
            ExprData::EArray(e) => self.lower_array_literal_expression(e),
            ExprData::EObject(e) => self.lower_object_literal_expression(e),
            ExprData::EFunction(e) => self.lower_function_expression(&e.func),
            ExprData::EClass(e) => self.lower_class_expression(e),
            ExprData::EArrow(e) => self.lower_arrow_function(e),
            ExprData::ENew(e) => self.lower_new_expression(e),
            ExprData::ENewTarget(_) => self.lower_new_target(),
            ExprData::EImportMeta(_) => self.lower_import_meta(),
            ExprData::EImport(e) => self.lower_import_call(e),
            ExprData::ETemplate(e) => self.lower_template_expression(e, false),
            ExprData::EUnary(e) => self.lower_prefix_unary_expression(e),
            ExprData::EAwait(e) => self.lower_await_expression(e),
            ExprData::EYield(e) => self.lower_yield_expression(e),
            ExprData::ESpread(e) => self.lower_spread_element(e),
            ExprData::EJsxElement(_) => Err(self.unsupported("JSX")),
            ExprData::EMissing(_) => Err(self.out_of_step("an expression of the tree is missing")),
            _ => Err(self.unsupported("a node that only the visit pass of Bun makes")),
        }
    }

    fn lower_literal(&mut self, kind: Kind) -> Lowering<NodeId> {
        if self.token != kind {
            return Err(self.out_of_step("a literal of the tree is not at its place"));
        }
        self.parse_literal_expression()
    }

    // parsePrefixUnaryExpression, parseDeleteExpression, parseTypeOfExpression, parseVoidExpression and the prefix half of parseUpdateExpression
    fn lower_prefix_unary_expression(&mut self, e: &'t E::Unary) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let operator = match e.op {
            OpCode::UnPos => Kind::PlusToken,
            OpCode::UnNeg => Kind::MinusToken,
            OpCode::UnCpl => Kind::TildeToken,
            OpCode::UnNot => Kind::ExclamationToken,
            OpCode::UnVoid => Kind::VoidKeyword,
            OpCode::UnTypeof => Kind::TypeOfKeyword,
            OpCode::UnDelete => Kind::DeleteKeyword,
            OpCode::UnPreDec => Kind::MinusMinusToken,
            OpCode::UnPreInc => Kind::PlusPlusToken,
            _ => return Err(self.unsupported("a unary operator of an unknown kind")),
        };
        self.expect(operator)?;
        let operand = self.lower_assignment_expression(&e.value)?;
        // parseUpdateExpression reads the operand of a prefix `++` or `--` with parseLeftHandSideExpressionOrHigher: Bun's parse takes any unary expression.
        if (operator == Kind::PlusPlusToken || operator == Kind::MinusMinusToken)
            && !is_left_hand_side_expression_kind(self.b.kind(operand))
        {
            return Err(self.out_of_step(
                "a prefix `++` or `--` before what the reference does not read as its operand",
            ));
        }
        let node = match operator {
            Kind::DeleteKeyword => self.b.new_delete_expression(operand),
            Kind::TypeOfKeyword => self.b.new_type_of_expression(operand),
            Kind::VoidKeyword => self.b.new_void_expression(operand),
            _ => self.b.new_prefix_unary_expression(operator, operand),
        };
        Ok(self.finish(node, pos))
    }

    // parseAwaitExpression
    fn lower_await_expression(&mut self, e: &'t E::Await) -> Lowering<NodeId> {
        let pos = self.node_pos();
        if self.token != Kind::AwaitKeyword {
            return Err(self.out_of_step("an await expression of the tree is not at its place"));
        }
        if !self.in_await_context() {
            // isAwaitExpression: outside an await context the reference reads an await expression only before a name or a literal on the same line.
            let mark = self.mark();
            let next = self.next_token();
            let on_same_line = !self.has_preceding_line_break();
            self.rewind(mark);
            let is_await_expression = on_same_line
                && (token_is_identifier_or_keyword(next)
                    || next == Kind::NumericLiteral
                    || next == Kind::BigIntLiteral
                    || next == Kind::StringLiteral);
            if !is_await_expression {
                // It reads the identifier `await`, which makes a module read the statement again, in an await context.
                self.statement_has_await_identifier = true;
                // What can follow that identifier in one expression keeps the statement whole; anything else ends it there.
                let continues = matches!(
                    next,
                    Kind::OpenParenToken
                        | Kind::OpenBracketToken
                        | Kind::NoSubstitutionTemplateLiteral
                        | Kind::TemplateHead
                        | Kind::PlusToken
                        | Kind::MinusToken
                        | Kind::SlashToken
                        | Kind::SlashEqualsToken
                        | Kind::LessThanToken
                );
                if !continues {
                    self.await_splits_statement = true;
                }
            }
        }
        self.next_token();
        let operand = self.lower_assignment_expression(&e.value)?;
        let node = self.b.new_await_expression(operand);
        Ok(self.finish(node, pos))
    }

    // parseYieldExpression
    fn lower_yield_expression(&mut self, e: &'t E::Yield) -> Lowering<NodeId> {
        let pos = self.node_pos();
        self.expect(Kind::YieldKeyword)?;
        // Without a line break, a `*` or the start of an expression makes the reference read an operand: else this is just a simple "yield" expression.
        let has_operand = !self.has_preceding_line_break()
            && (self.token == Kind::AsteriskToken || self.is_start_of_expression());
        if has_operand != e.value.is_some() || (e.is_star && !has_operand) {
            return Err(self.out_of_step("the operand of a yield expression"));
        }
        let asterisk_token = if e.is_star {
            self.expect_token_node(Kind::AsteriskToken)?
        } else {
            NodeId::NIL
        };
        let expression = match &e.value {
            Some(value) => self.lower_assignment_expression(value)?,
            None => NodeId::NIL,
        };
        let node = self.b.new_yield_expression(asterisk_token, expression);
        Ok(self.finish(node, pos))
    }

    // parseArrayLiteralExpression
    fn lower_array_literal_expression(&mut self, e: &'t E::Array) -> Lowering<NodeId> {
        let pos = self.node_pos();
        self.expect(Kind::OpenBracketToken)?;
        let multi_line = self.has_preceding_line_break();
        let elements = self.lower_delimited(
            e.items.as_slice(),
            Some(Kind::CloseBracketToken),
            |this, item| this.lower_argument_or_array_literal_element(item),
        )?;
        self.expect(Kind::CloseBracketToken)?;
        let node = self.b.new_array_literal_expression(elements, multi_line);
        Ok(self.finish(node, pos))
    }

    // parseObjectLiteralExpression
    fn lower_object_literal_expression(&mut self, e: &'t E::Object) -> Lowering<NodeId> {
        let pos = self.node_pos();
        self.expect(Kind::OpenBraceToken)?;
        let multi_line = self.has_preceding_line_break();
        let properties = self.lower_delimited(
            e.properties.as_slice(),
            Some(Kind::CloseBraceToken),
            |this, property| this.lower_object_literal_element(property),
        )?;
        self.expect(Kind::CloseBraceToken)?;
        let node = self.b.new_object_literal_expression(properties, multi_line);
        Ok(self.finish(node, pos))
    }

    // parseObjectLiteralElement
    fn lower_object_literal_element(&mut self, property: &'t G::Property) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        if property.kind == G::PropertyKind::Spread {
            self.expect(Kind::DotDotDotToken)?;
            let Some(value) = property.value.as_ref() else {
                return Err(self.out_of_step("a spread property of the tree has no value"));
            };
            let expression = self.lower_assignment_expression(value)?;
            let result = self.b.new_spread_assignment(expression);
            self.finish(result, pos);
            self.with_jsdoc(result, jsdoc);
            return Ok(result);
        }
        let function = method_function(property);
        // parseModifiersEx: the only modifier of a member that Bun accepts is `async`, before a method.
        let is_async =
            function.is_some_and(|func| func.flags.contains(bun_ast::flags::Function::IsAsync));
        let modifiers = if is_async && self.token == Kind::AsyncKeyword {
            let modifier = self.parse_token_node();
            let end = self.node_pos();
            self.new_modifier_list(pos, end, &[modifier])
        } else {
            ModifierListId::NIL
        };
        if property.kind == G::PropertyKind::Get || property.kind == G::PropertyKind::Set {
            let Some(func) = function else {
                return Err(self.out_of_step("an accessor of the tree has no function"));
            };
            return self.lower_accessor_declaration(pos, jsdoc, modifiers, property, func);
        }
        let asterisk_token = self.optional_token_node(Kind::AsteriskToken);
        let token_is_identifier = self.is_identifier();
        let name = self.lower_property_name(property)?;
        if !asterisk_token.is_nil() || self.token == Kind::OpenParenToken {
            let Some(func) = function else {
                return Err(self.out_of_step("a method of the tree has no function"));
            };
            return self.lower_method_declaration(
                pos,
                jsdoc,
                modifiers,
                asterisk_token,
                name,
                func,
            );
        }
        // check if it is short-hand property assignment or normal property assignment
        let is_shorthand_property_assignment =
            token_is_identifier && self.token != Kind::ColonToken;
        let node = if is_shorthand_property_assignment {
            let equals_token = self.optional_token_node(Kind::EqualsToken);
            let mut initializer = NodeId::NIL;
            if !equals_token.is_nil() {
                let Some(value) = property.initializer.as_ref() else {
                    return Err(
                        self.out_of_step("a default of a shorthand property is not in the tree")
                    );
                };
                initializer = self.lower_allowing_in(value)?;
            }
            self.b.new_shorthand_property_assignment(
                modifiers,
                name,
                NodeId::NIL,
                NodeId::NIL,
                equals_token,
                initializer,
            )
        } else {
            self.expect(Kind::ColonToken)?;
            let Some(value) = property.value.as_ref() else {
                return Err(self.out_of_step("a property of the tree has no value"));
            };
            let initializer = self.lower_allowing_in(value)?;
            self.b
                .new_property_assignment(modifiers, name, NodeId::NIL, NodeId::NIL, initializer)
        };
        self.finish(node, pos);
        self.with_jsdoc(node, jsdoc);
        Ok(node)
    }

    // doInContext(p, ast.NodeFlagsDisallowInContext, false, (*Parser).parseAssignmentExpressionOrHigher)
    fn lower_allowing_in(&mut self, expr: &'t Expr) -> Lowering<NodeId> {
        let save_context_flags = self.context_flags;
        self.set_context_flags(NodeFlags::DISALLOW_IN_CONTEXT, false);
        let node = self.lower_assignment_expression(expr);
        self.context_flags = save_context_flags;
        node
    }

    // parseTemplateExpression
    fn lower_template_expression(
        &mut self,
        e: &'t E::Template,
        is_tagged_template: bool,
    ) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let head = self.parse_template_head(is_tagged_template)?;
        // parseTemplateSpans
        let spans_pos = self.node_pos();
        let parts = e.parts.slice();
        let mut list: Vec<NodeId> = Vec::with_capacity(parts.len());
        for part in parts {
            // parseTemplateSpan
            let span_pos = self.node_pos();
            let expression = self.lower_expression_allow_in(&part.value)?;
            let literal = self.parse_literal_of_template_span(is_tagged_template)?;
            let span = self.b.new_template_span(expression, literal);
            list.push(self.finish(span, span_pos));
        }
        let spans_end = self.node_pos();
        let template_spans = self.new_list(spans_pos, spans_end, &list);
        let node = self.b.new_template_expression(head, template_spans);
        Ok(self.finish(node, pos))
    }

    // getTemplateLiteralRawText
    fn template_literal_raw_text(&self, end_length: usize) -> &'t [u8] {
        let token_text = self.scanner.token_text();
        let end_length = if self
            .scanner
            .token_flags()
            .intersects(TokenFlags::UNTERMINATED)
        {
            0
        } else {
            end_length
        };
        let end = token_text.len().saturating_sub(end_length).max(1);
        token_text.get(1..end).unwrap_or(&[])
    }

    // parseTemplateHead
    fn parse_template_head(&mut self, is_tagged_template: bool) -> Lowering<NodeId> {
        if self.token != Kind::TemplateHead {
            return Err(self.out_of_step("a template of the tree is not at its place"));
        }
        if !is_tagged_template
            && self
                .scanner
                .token_flags()
                .intersects(TokenFlags::IS_INVALID)
        {
            self.re_scan_template_token(false);
        }
        let pos = self.node_pos();
        let raw_text = self.template_literal_raw_text(2);
        let result = self.b.new_template_head(
            self.scanner.token_value(),
            raw_text,
            self.scanner.token_flags(),
        );
        self.next_token();
        Ok(self.finish(result, pos))
    }

    // parseLiteralOfTemplateSpan and parseTemplateMiddleOrTail
    fn parse_literal_of_template_span(&mut self, is_tagged_template: bool) -> Lowering<NodeId> {
        if self.token != Kind::CloseBraceToken {
            return Err(self.out_of_step("the `}` that ends a substitution of a template"));
        }
        self.re_scan_template_token(is_tagged_template);
        let pos = self.node_pos();
        let result = if self.token == Kind::TemplateMiddle {
            let raw_text = self.template_literal_raw_text(2);
            self.b.new_template_middle(
                self.scanner.token_value(),
                raw_text,
                self.scanner.token_flags(),
            )
        } else {
            let raw_text = self.template_literal_raw_text(1);
            self.b.new_template_tail(
                self.scanner.token_value(),
                raw_text,
                self.scanner.token_flags(),
            )
        };
        self.next_token();
        Ok(self.finish(result, pos))
    }

    // parseNewExpressionOrNewDotTarget, the `new` expression
    fn lower_new_expression(&mut self, e: &'t E::New) -> Lowering<NodeId> {
        let pos = self.node_pos();
        self.expect(Kind::NewKeyword)?;
        // Bun read the callee as a member expression too, so its chain holds no call that is not in parentheses.
        let expression = self.lower_assignment_expression(&e.target)?;
        // parseMemberExpressionRest reads the callee without an optional chain: at a `?.` the reference ends it, with an error.
        if self
            .b
            .flags(expression)
            .intersects(NodeFlags::OPTIONAL_CHAIN)
        {
            return Err(self.out_of_step("an optional chain in the callee of `new`"));
        }
        let argument_list = if self.token == Kind::OpenParenToken {
            self.lower_argument_list(e.args.as_slice())?
        } else {
            NodeListId::NIL
        };
        let node = self
            .b
            .new_new_expression(expression, NodeListId::NIL, argument_list);
        Ok(self.finish(node, pos))
    }

    // parseNewExpressionOrNewDotTarget, `new.target`
    fn lower_new_target(&mut self) -> Lowering<NodeId> {
        let pos = self.node_pos();
        self.expect(Kind::NewKeyword)?;
        self.expect(Kind::DotToken)?;
        let name = self.create_identifier()?;
        let node = self.b.new_meta_property(Kind::NewKeyword, name);
        Ok(self.finish(node, pos))
    }

    // parseLeftHandSideExpressionOrHigher, the 'import.*' metaproperty
    fn lower_import_meta(&mut self) -> Lowering<NodeId> {
        let pos = self.node_pos();
        self.expect(Kind::ImportKeyword)?;
        self.expect(Kind::DotToken)?;
        let name = self.create_identifier()?;
        let node = self.b.new_meta_property(Kind::ImportKeyword, name);
        self.source_flags |= NodeFlags::POSSIBLY_CONTAINS_IMPORT_META;
        if self.first_import_meta.is_nil() {
            self.first_import_meta = node;
        }
        Ok(self.finish(node, pos))
    }

    // parseLeftHandSideExpressionOrHigher, the import call: the keyword, then parseCallExpressionRest
    fn lower_import_call(&mut self, e: &'t E::Import) -> Lowering<NodeId> {
        let pos = self.node_pos();
        self.source_flags |= NodeFlags::POSSIBLY_CONTAINS_DYNAMIC_IMPORT;
        let expression = self.parse_keyword_expression(Kind::ImportKeyword)?;
        self.expect(Kind::OpenParenToken)?;
        let list_pos = self.node_pos();
        let mut arguments: Vec<NodeId> = Vec::with_capacity(2);
        arguments.push(self.lower_argument_expression(&e.expr)?);
        if self.optional(Kind::CommaToken) && self.token != Kind::CloseParenToken {
            if matches!(e.options.data, ExprData::EMissing(_)) {
                return Err(self.out_of_step("the options of an import call are not in the tree"));
            }
            arguments.push(self.lower_argument_expression(&e.options)?);
            self.optional(Kind::CommaToken);
        }
        let list_end = self.node_pos();
        let argument_list = self.new_list(list_pos, list_end, &arguments);
        self.expect(Kind::CloseParenToken)?;
        let node = self.b.new_call_expression(
            expression,
            NodeId::NIL,
            NodeListId::NIL,
            argument_list,
            NodeFlags::NONE,
        );
        Ok(self.finish(node, pos))
    }

    // parseParenthesizedArrowFunctionExpression and parseSimpleArrowFunctionExpression: Bun's tree says that an arrow function starts here.
    fn lower_arrow_function(&mut self, e: &'t E::Arrow) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        // parseModifiersForArrowFunction
        let modifiers = if e.is_async {
            if self.token != Kind::AsyncKeyword {
                return Err(self.out_of_step("the `async` of an arrow function"));
            }
            let modifier = self.parse_token_node();
            let end = self.node_pos();
            self.new_modifier_list(pos, end, &[modifier])
        } else {
            ModifierListId::NIL
        };
        let args = e.args.slice();
        let parameters = if self.token == Kind::OpenParenToken {
            self.expect(Kind::OpenParenToken)?;
            let parameters = self.lower_parameters_worker(false, e.is_async, args)?;
            self.expect(Kind::CloseParenToken)?;
            parameters
        } else {
            if args.len() != 1 {
                return Err(
                    self.out_of_step("the one parameter of an arrow function without parentheses")
                );
            }
            let parameter_pos = self.node_pos();
            let identifier = self.create_identifier()?;
            let parameter = self.b.new_parameter_declaration(
                ModifierListId::NIL,
                NodeId::NIL,
                identifier,
                NodeId::NIL,
                NodeId::NIL,
                NodeId::NIL,
            );
            self.finish(parameter, parameter_pos);
            let parameter_end = self.node_pos();
            self.new_list(parameter_pos, parameter_end, &[parameter])
        };
        let equals_greater_than_token = self.expect_token_node(Kind::EqualsGreaterThanToken)?;
        let body = self.lower_arrow_function_expression_body(e)?;
        let result = self.b.new_arrow_function(
            modifiers,
            NodeListId::NIL,
            parameters,
            NodeId::NIL,
            NodeId::NIL,
            equals_greater_than_token,
            body,
        );
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseArrowFunctionExpressionBody
    fn lower_arrow_function_expression_body(&mut self, e: &'t E::Arrow) -> Lowering<NodeId> {
        if !e.prefer_expr {
            return self.lower_function_block(false, e.is_async, e.body.stmts.slice());
        }
        // Bun keeps an expression body as the one return statement of the body.
        let value = match e.body.stmts.slice() {
            [only] => match &only.data {
                StmtData::SReturn(statement) => statement.value.as_ref(),
                _ => None,
            },
            _ => None,
        };
        let Some(value) = value else {
            return Err(self.out_of_step("the expression body of an arrow function"));
        };
        let save_context_flags = self.context_flags;
        self.set_context_flags(NodeFlags::AWAIT_CONTEXT, e.is_async);
        self.set_context_flags(NodeFlags::YIELD_CONTEXT, false);
        let node = self.lower_assignment_expression(value);
        self.context_flags = save_context_flags;
        node
    }
}
