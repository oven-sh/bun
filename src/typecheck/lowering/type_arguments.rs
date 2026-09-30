// Type arguments after an expression: the reference tries them in a TypeScript file at a `<` that Bun's JavaScript parse reads as an operator.
use super::{Lowerer, token_is_identifier_or_keyword};
use crate::ast::{Kind, NodeFlags, OperatorPrecedence, get_binary_operator_precedence};

// How many tokens the search for a `>` reads before it answers that one follows.
const MAX_TOKENS_TO_A_GREATER_THAN: u32 = 4096;

impl Lowerer<'_, '_> {
    // tryParseTypeArgumentsInExpression at the `<` or `<<` that the lowering is at: true when the reference reads type arguments there, or when only its type grammar can tell.
    pub(super) fn reference_may_read_type_arguments(&mut self) -> bool {
        // TypeArguments must not be parsed in JavaScript files to avoid ambiguity with binary operators.
        if self.context_flags.intersects(NodeFlags::JAVA_SCRIPT_FILE) {
            return false;
        }
        // parseMemberExpressionRest tries them: a postfix `++` or `--` before the `<` is read after that function returned.
        let end_of_operand = usize::try_from(self.node_pos()).unwrap_or(0);
        let before = self.scanner.text().get(..end_of_operand).unwrap_or(&[]);
        if before.ends_with(b"++") || before.ends_with(b"--") {
            return false;
        }
        let exact = if self.token == Kind::LessThanToken {
            self.look_ahead(|this| this.names_and_literals_are_type_arguments())
        } else {
            None
        };
        match exact {
            Some(reads) => reads,
            None => self.look_ahead(|this| this.greater_than_follows()),
        }
    }

    // What the reference answers when every type argument is made of names, literals, `typeof`, `this`, indexes, `|` and `&`: None when a token needs the type grammar.
    fn names_and_literals_are_type_arguments(&mut self) -> Option<bool> {
        self.next_token();
        self.skip_type_argument_list()?;
        // If it doesn't have the closing `>` then it's definitely not an type argument list.
        if self.re_scan_greater_than_token() != Kind::GreaterThanToken {
            return Some(false);
        }
        self.next_token();
        Some(self.can_follow_type_arguments_in_expression())
    }

    // parseDelimitedList(PCTypeArguments, parseType): an element starts at a comma or at the start of a type, and any token that is no comma ends the list.
    fn skip_type_argument_list(&mut self) -> Option<()> {
        loop {
            if self.token != Kind::CommaToken && !self.is_start_of_type()? {
                return Some(());
            }
            self.skip_type()?;
            if !self.optional(Kind::CommaToken) {
                return Some(());
            }
        }
    }

    // isStartOfType
    fn is_start_of_type(&mut self) -> Option<bool> {
        Some(match self.token {
            Kind::AnyKeyword
            | Kind::UnknownKeyword
            | Kind::StringKeyword
            | Kind::NumberKeyword
            | Kind::BigIntKeyword
            | Kind::BooleanKeyword
            | Kind::ReadonlyKeyword
            | Kind::SymbolKeyword
            | Kind::UniqueKeyword
            | Kind::VoidKeyword
            | Kind::UndefinedKeyword
            | Kind::NullKeyword
            | Kind::ThisKeyword
            | Kind::TypeOfKeyword
            | Kind::NeverKeyword
            | Kind::OpenBraceToken
            | Kind::OpenBracketToken
            | Kind::LessThanToken
            | Kind::BarToken
            | Kind::AmpersandToken
            | Kind::NewKeyword
            | Kind::StringLiteral
            | Kind::NumericLiteral
            | Kind::BigIntLiteral
            | Kind::TrueKeyword
            | Kind::FalseKeyword
            | Kind::ObjectKeyword
            | Kind::AsteriskToken
            | Kind::QuestionToken
            | Kind::ExclamationToken
            | Kind::DotDotDotToken
            | Kind::InferKeyword
            | Kind::ImportKeyword
            | Kind::AssertsKeyword
            | Kind::NoSubstitutionTemplateLiteral
            | Kind::TemplateHead
            | Kind::FunctionKeyword => true,
            Kind::MinusToken => self.next_token_is_numeric_or_big_int_literal(),
            // Only the type grammar tells whether a `(` starts a parenthesized or a function type.
            Kind::OpenParenToken => return None,
            _ => self.is_identifier(),
        })
    }

    // lookAhead(nextTokenIsNumericOrBigIntLiteral)
    fn next_token_is_numeric_or_big_int_literal(&mut self) -> bool {
        self.look_ahead(|this| {
            matches!(
                this.next_token(),
                Kind::NumericLiteral | Kind::BigIntLiteral
            )
        })
    }

    // parseType, as far as a union or an intersection of the types that skip_postfix_type reads
    fn skip_type(&mut self) -> Option<()> {
        if !self.stack_check.is_safe_to_recurse() {
            return None;
        }
        let save_context_flags = self.context_flags;
        self.set_context_flags(NodeFlags::TYPE_EXCLUDES_FLAGS, false);
        let result = self.skip_union_or_intersection_type();
        self.context_flags = save_context_flags;
        result
    }

    // parseUnionOrIntersectionType of both levels: a leading operator and the operators between the constituents, each followed by a constituent that can be missing
    fn skip_union_or_intersection_type(&mut self) -> Option<()> {
        loop {
            while self.token == Kind::BarToken || self.token == Kind::AmpersandToken {
                self.next_token();
            }
            self.skip_postfix_type()?;
            if self.token != Kind::BarToken && self.token != Kind::AmpersandToken {
                break;
            }
        }
        // A conditional type.
        if self.token == Kind::ExtendsKeyword {
            return None;
        }
        Some(())
    }

    // parseTypeOperatorOrHigher, parsePostfixTypeOrHigher and parseNonArrayType
    fn skip_postfix_type(&mut self) -> Option<()> {
        match self.token {
            // A function type, a constructor type, a type operator, a JSDoc type, an object type, a tuple, a template, an import type: the type grammar.
            Kind::LessThanToken
            | Kind::LessThanLessThanToken
            | Kind::OpenParenToken
            | Kind::NewKeyword
            | Kind::AbstractKeyword
            | Kind::KeyOfKeyword
            | Kind::UniqueKeyword
            | Kind::ReadonlyKeyword
            | Kind::InferKeyword
            | Kind::AssertsKeyword
            | Kind::ImportKeyword
            | Kind::AsteriskToken
            | Kind::AsteriskEqualsToken
            | Kind::QuestionToken
            | Kind::QuestionQuestionToken
            | Kind::ExclamationToken
            | Kind::OpenBraceToken
            | Kind::OpenBracketToken
            | Kind::TemplateHead => return None,
            // parseLiteralTypeNode and the keyword type `void`
            Kind::NoSubstitutionTemplateLiteral
            | Kind::StringLiteral
            | Kind::NumericLiteral
            | Kind::BigIntLiteral
            | Kind::TrueKeyword
            | Kind::FalseKeyword
            | Kind::NullKeyword
            | Kind::VoidKeyword => {
                self.next_token();
            }
            // A negative literal type, else a type reference whose name is missing.
            Kind::MinusToken => {
                if self.next_token_is_numeric_or_big_int_literal() {
                    self.next_token();
                    self.next_token();
                }
            }
            Kind::ThisKeyword => {
                self.next_token();
                // parseThisTypePredicate
                if self.token == Kind::IsKeyword && !self.has_preceding_line_break() {
                    return None;
                }
            }
            Kind::TypeOfKeyword => {
                // nextIsStartOfTypeOfImportType
                if self.look_ahead(|this| this.next_token() == Kind::ImportKeyword) {
                    return None;
                }
                self.next_token();
                self.skip_entity_name()?;
            }
            // parseTypeReference, also for a keyword type: before a dot it is a name, and alone it is one token as well.
            _ => self.skip_entity_name()?,
        }
        while !self.has_preceding_line_break() {
            match self.token {
                // A JSDoc non-nullable type.
                Kind::ExclamationToken => return None,
                Kind::QuestionToken => {
                    // If next token is start of a type we have a conditional type
                    let next_is_start_of_type = self.look_ahead(|this| {
                        this.next_token();
                        this.is_start_of_type()
                    })?;
                    if next_is_start_of_type {
                        break;
                    }
                    self.next_token();
                }
                Kind::OpenBracketToken => {
                    self.next_token();
                    if self.is_start_of_type()? {
                        self.skip_type()?;
                    }
                    self.optional(Kind::CloseBracketToken);
                }
                _ => break,
            }
        }
        Some(())
    }

    // parseEntityName with reserved words, up to where the type arguments of the name would start
    fn skip_entity_name(&mut self) -> Option<()> {
        if token_is_identifier_or_keyword(self.token) {
            self.next_token();
        }
        while self.token == Kind::DotToken {
            self.next_token();
            // parseRightSideOfDot reads a name on the next line by what follows it, and a private name with an error: the type grammar.
            if self.token == Kind::LessThanToken
                || self.token == Kind::PrivateIdentifier
                || self.has_preceding_line_break()
            {
                return None;
            }
            if token_is_identifier_or_keyword(self.token) {
                self.next_token();
            }
        }
        // parseTypeArguments: a list inside the list.
        if self.token == Kind::LessThanToken || self.token == Kind::LessThanLessThanToken {
            return None;
        }
        Some(())
    }

    // canFollowTypeArgumentsInExpression
    fn can_follow_type_arguments_in_expression(&mut self) -> bool {
        match self.token {
            // These tokens can follow a type argument list in a call expression.
            Kind::OpenParenToken | Kind::NoSubstitutionTemplateLiteral | Kind::TemplateHead => true,
            // A type argument list followed by `<` never makes sense, one followed by `>` is ambiguous with a (re-scanned) `>>` operator, and `+` and `-` are unary operators in this context.
            Kind::LessThanToken | Kind::GreaterThanToken | Kind::PlusToken | Kind::MinusToken => {
                false
            }
            // We favor the type argument list interpretation when it is immediately followed by a line break, a binary operator, or something that can't start an expression.
            _ => {
                self.has_preceding_line_break()
                    || self.is_binary_operator()
                    || !self.is_start_of_expression()
            }
        }
    }

    // isBinaryOperator
    fn is_binary_operator(&self) -> bool {
        if self
            .context_flags
            .intersects(NodeFlags::DISALLOW_IN_CONTEXT)
            && self.token == Kind::InKeyword
        {
            return false;
        }
        get_binary_operator_precedence(self.token) != OperatorPrecedence::INVALID
    }

    // isStartOfExpression
    pub(super) fn is_start_of_expression(&mut self) -> bool {
        if self.is_start_of_left_hand_side_expression() {
            return true;
        }
        match self.token {
            // Yield/await always starts an expression: it is an identifier, or a keyword that starts a yield or await expression.
            Kind::PlusToken
            | Kind::MinusToken
            | Kind::TildeToken
            | Kind::ExclamationToken
            | Kind::DeleteKeyword
            | Kind::TypeOfKeyword
            | Kind::VoidKeyword
            | Kind::PlusPlusToken
            | Kind::MinusMinusToken
            | Kind::LessThanToken
            | Kind::AwaitKeyword
            | Kind::YieldKeyword
            | Kind::PrivateIdentifier
            | Kind::AtToken => true,
            // Error tolerance: the start of some binary operator is the start of an expression whose left side is missing.
            _ => self.is_binary_operator() || self.is_identifier(),
        }
    }

    // isStartOfLeftHandSideExpression
    fn is_start_of_left_hand_side_expression(&mut self) -> bool {
        match self.token {
            Kind::ThisKeyword
            | Kind::SuperKeyword
            | Kind::NullKeyword
            | Kind::TrueKeyword
            | Kind::FalseKeyword
            | Kind::NumericLiteral
            | Kind::BigIntLiteral
            | Kind::StringLiteral
            | Kind::NoSubstitutionTemplateLiteral
            | Kind::TemplateHead
            | Kind::OpenParenToken
            | Kind::OpenBracketToken
            | Kind::OpenBraceToken
            | Kind::FunctionKeyword
            | Kind::ClassKeyword
            | Kind::NewKeyword
            | Kind::SlashToken
            | Kind::SlashEqualsToken
            | Kind::Identifier => true,
            // nextTokenIsOpenParenOrLessThanOrDot
            Kind::ImportKeyword => self.look_ahead(|this| {
                matches!(
                    this.next_token(),
                    Kind::OpenParenToken | Kind::LessThanToken | Kind::DotToken
                )
            }),
            _ => self.is_identifier(),
        }
    }

    // Whether a `>` follows before a token that no type can hold: a `;` outside every bracket, a bracket that closes none of the open ones, the end of the file. A template with substitutions counts as a `>`: the reference scans its parts another way.
    fn greater_than_follows(&mut self) -> bool {
        let mut open: Vec<Kind> = Vec::new();
        let mut tokens = 0u32;
        loop {
            let opener = match self.next_token_without_check() {
                Kind::EndOfFile => return false,
                Kind::GreaterThanToken | Kind::TemplateHead => return true,
                Kind::SemicolonToken if open.is_empty() => return false,
                Kind::OpenParenToken | Kind::OpenBracketToken | Kind::OpenBraceToken => {
                    open.push(self.token);
                    Kind::Unknown
                }
                Kind::CloseParenToken => Kind::OpenParenToken,
                Kind::CloseBracketToken => Kind::OpenBracketToken,
                Kind::CloseBraceToken => Kind::OpenBraceToken,
                _ => Kind::Unknown,
            };
            if opener != Kind::Unknown {
                // A type that ended without its closing bracket leaves that bracket open for the scan: the closing bracket of an outer one passes it.
                match open.iter().rposition(|kind| *kind == opener) {
                    Some(at) => open.truncate(at),
                    None => return false,
                }
            }
            tokens += 1;
            if tokens >= MAX_TOKENS_TO_A_GREATER_THAN {
                return true;
            }
        }
    }
}
