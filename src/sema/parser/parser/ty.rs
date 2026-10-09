//! Types, and the declarations that consist of types.

use super::stmt::{ModifiersOf, Start};
use super::{GrammarError, ListKind, Parser, ctx, take_span};
use crate::Refusal;
use crate::lexer::Mark;
use crate::token::T;
use bun_sema::atom::{Atom, known};
use bun_sema::hir::*;

impl Parser<'_> {
    #[inline(always)]
    pub(crate) fn add_type(&mut self, kind: TypeNodeKind, pos: u32, end: u32) -> TypeNodeId {
        let id = TypeNodeId(self.f.types.len() as u32);
        self.f.types.push(TypeNode { kind, pos, end });
        id
    }

    /// A type that ends with the previous token.
    #[inline(always)]
    pub(crate) fn finish_type(&mut self, kind: TypeNodeKind, pos: u32) -> TypeNodeId {
        let end = self.prev_end();
        self.add_type(kind, pos, end)
    }

    /// A type that is the token, which is consumed.
    #[inline(always)]
    pub(crate) fn token_type(&mut self, kind: TypeNodeKind) -> TypeNodeId {
        let id = self.add_type(kind, self.lx.start, self.lx.end);
        self.next();
        id
    }

    /// `parseTypeAnnotation`
    #[inline]
    pub(crate) fn type_annotation(&mut self) -> TypeNodeId {
        if self.token() != T::Colon {
            return TypeNodeId::NONE;
        }
        self.next();
        if self.options.is_javascript {
            return self.type_annotation_in_javascript();
        }
        self.ty()
    }

    /// `parseTypeAnnotation`, after the `:`.
    #[cold]
    fn type_annotation_in_javascript(&mut self) -> TypeNodeId {
        if self.is_flow {
            return self.flow_type();
        }
        let ty = self.ty();
        self.js_error_at_type(ty, 8010);
        ty
    }

    /// `parseType`
    pub(crate) fn ty(&mut self) -> TypeNodeId {
        if self.is_too_deep() {
            return TypeNodeId::NONE;
        }
        // `TypeExcludesFlags`
        let saved = self.enter_context(ctx::TYPE, ctx::YIELD | ctx::AWAIT);
        let ty = self.type_in_context();
        self.context = saved;
        ty
    }

    fn type_in_context(&mut self) -> TypeNodeId {
        if self.is_start_of_function_or_constructor_type() {
            return self.function_or_constructor_type();
        }
        let start = self.pos();
        let check = self.union_type();
        if self.token() != T::Extends
            || self.has_context(ctx::DISALLOW_CONDITIONAL_TYPES)
            || self.newline_before()
        {
            return check;
        }
        self.next();
        // "The type following 'extends' is not permitted to be another conditional type"
        let saved = self.enter_context(ctx::DISALLOW_CONDITIONAL_TYPES, 0);
        let extends = self.ty();
        self.context = saved;
        self.expect(T::Question);
        let saved = self.enter_context(0, ctx::DISALLOW_CONDITIONAL_TYPES);
        let yes = self.ty();
        self.expect(T::Colon);
        let no = self.ty();
        self.context = saved;
        let kind = TypeNodeKind::Cond {
            check,
            extends,
            yes,
            no,
        };
        self.finish_type(kind, start)
    }

    /// `isStartOfFunctionTypeOrConstructorType`
    fn is_start_of_function_or_constructor_type(&mut self) -> bool {
        match self.token() {
            T::LessThan | T::New => true,
            T::OpenParen => self.is_at_parameters_of_function_type(),
            T::Abstract => self.peek() == T::New,
            _ => false,
        }
    }

    /// `lookAhead(isUnambiguouslyStartOfFunctionType)`
    fn is_at_parameters_of_function_type(&mut self) -> bool {
        // A pattern after the `(` is parsed to get past it, with the types in it, and in them every
        // `(` is asked about again, twice. An answer that took long is kept: otherwise each level of
        // `({[a as ({[b as ..` takes three times as long as the one in it.
        let at = (self.pos(), self.context);
        let mut place = 0;
        if !self.function_type_starts.is_empty() {
            // What is before a token that is read for good is not read again.
            if self.speculations == 0 {
                let read = self.function_type_starts.partition_point(|it| it.0 < at.0);
                self.function_type_starts.drain(..read);
            }
            let kept = &self.function_type_starts;
            match kept.binary_search_by_key(&at, |it| (it.0, it.1)) {
                Ok(known) => return kept.get(known).is_some_and(|it| it.2),
                Err(free) => place = free,
            }
        }
        let mut end = at.0;
        let answer = self.look_ahead_parsing(|p| {
            let answer = p.is_unambiguously_start_of_function_type();
            end = p.pos();
            answer
        });
        // What was kept on the way is behind it.
        if end.saturating_sub(at.0) > 64 {
            self.function_type_starts
                .insert(place, (at.0, at.1, answer));
        }
        answer
    }

    /// `isUnambiguouslyStartOfFunctionType`
    fn is_unambiguously_start_of_function_type(&mut self) -> bool {
        self.next();
        if matches!(self.token(), T::CloseParen | T::DotDotDot) {
            // "( )", "( ..."
            return true;
        }
        // `skipParameterStart`
        if self.token().is_modifier() {
            let base = self.s.modifiers.len();
            self.modifiers(ModifiersOf::TypeMember);
            self.s.modifiers.truncate(base);
            self.eat(T::DotDotDot);
        }
        if self.is_identifier() || self.token() == T::This {
            self.next();
        } else if matches!(self.token(), T::OpenBracket | T::OpenBrace) {
            // "Return true if we can parse an array or object binding pattern with no errors"
            let errors = self.number_of_errors();
            self.identifier_or_pattern();
            if self.has_failed() || self.number_of_errors() != errors {
                return false;
            }
        } else {
            return false;
        }
        match self.token() {
            // "( xxx :", "( xxx ,", "( xxx ?", "( xxx ="
            T::Colon | T::Comma | T::Question | T::Equals => true,
            T::CloseParen => {
                self.next();
                // "( xxx ) =>"
                self.token() == T::EqualsGreaterThan
            }
            _ => false,
        }
    }

    /// `len(p.diagnostics)`. Only recovery has any.
    #[inline]
    fn number_of_errors(&mut self) -> usize {
        match self.recovers {
            true => self.count_errors(),
            false => 0,
        }
    }

    #[cold]
    #[inline(never)]
    fn count_errors(&mut self) -> usize {
        // One of the scanner's that starts where the last error starts does not count.
        self.take_errors_of_scanner();
        let is_of_parser = |it: &&Diagnostic| it.kind == DiagnosticKind::Parse;
        self.f.diagnostics.iter().filter(is_of_parser).count()
    }

    /// `parseFunctionOrConstructorType`
    fn function_or_constructor_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        let mut flags = Flags::empty();
        if self.eat(T::Abstract) {
            flags |= Flags::ABSTRACT;
        }
        let kind = match self.eat(T::New) {
            true => FnKind::ConstructorType,
            false => FnKind::FunctionType,
        };
        let name_pos = self.pos();
        let type_params = self.type_parameters();
        let anchor = self.pos();
        let (this_param, params) = self.parameters(0);
        self.expect(T::EqualsGreaterThan);
        let ret = self.type_or_type_predicate();
        let func = self.f.add_fn(Func {
            kind,
            flags,
            name: Atom::NONE,
            name_pos,
            type_params,
            params,
            this_param,
            ret,
            body: FnBody::None,
            anchor,
            start,
        });
        self.finish_type(TypeNodeKind::Fn(func), start)
    }

    /// `parseTypeOrTypePredicate`
    pub(crate) fn type_or_type_predicate(&mut self) -> TypeNodeId {
        if self.is_flow {
            return self.flow_return_type_of_function();
        }
        // `parseReturnType`: `T extends () => A extends B ? 1 : 0 ? C : D`
        let saved = self.enter_context(0, ctx::DISALLOW_CONDITIONAL_TYPES);
        let ty = self.type_or_type_predicate_in_context();
        self.context = saved;
        ty
    }

    fn type_or_type_predicate_in_context(&mut self) -> TypeNodeId {
        if self.is_identifier() {
            // `parseTypePredicatePrefix`
            let is_predicate = self.look_ahead(|p| {
                p.next();
                p.token() == T::Is && !p.newline_before()
            });
            if is_predicate {
                let (param, start) = self.identifier();
                self.next();
                let ty = self.ty();
                let kind = TypeNodeKind::Predicate {
                    param,
                    ty,
                    asserts: false,
                };
                return self.finish_type(kind, start);
            }
        }
        self.ty()
    }

    /// `parseUnionTypeOrHigher`
    fn union_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        let has_leading_operator = self.eat(T::Bar);
        let first = match has_leading_operator {
            true => self.member_of_union(),
            false => self.intersection_type(),
        };
        if self.token() != T::Bar && !has_leading_operator {
            return first;
        }
        let base = self.s.ids.len();
        self.s.ids.push(first.0);
        while self.eat(T::Bar) {
            let member = self.member_of_union();
            self.s.ids.push(member.0);
        }
        let members = self.take_ids(base);
        self.finish_type(TypeNodeKind::Union(members), start)
    }

    /// `parseIntersectionTypeOrHigher`
    fn intersection_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        let has_leading_operator = self.eat(T::Ampersand);
        let first = match has_leading_operator {
            true => self.member_of_intersection(),
            false => self.type_operator(),
        };
        if self.token() != T::Ampersand && !has_leading_operator {
            return first;
        }
        let base = self.s.ids.len();
        self.s.ids.push(first.0);
        while self.eat(T::Ampersand) {
            let member = self.member_of_intersection();
            self.s.ids.push(member.0);
        }
        let members = self.take_ids(base);
        self.finish_type(TypeNodeKind::Intersection(members), start)
    }

    /// `parseFunctionOrConstructorTypeToError(true, parseIntersectionTypeOrHigher)`, after a `|`.
    #[inline]
    fn member_of_union(&mut self) -> TypeNodeId {
        if self.is_start_of_function_or_constructor_type() {
            return self.function_type_without_parentheses(T::Bar);
        }
        self.intersection_type()
    }

    /// `parseFunctionOrConstructorTypeToError(false, parseTypeOperatorOrHigher)`, after a `&`.
    #[inline]
    fn member_of_intersection(&mut self) -> TypeNodeId {
        if self.is_start_of_function_or_constructor_type() {
            return self.function_type_without_parentheses(T::Ampersand);
        }
        self.type_operator()
    }

    /// `parseFunctionOrConstructorTypeToError`, where a function type starts after `operator`.
    #[cold]
    #[inline(never)]
    fn function_type_without_parentheses(&mut self, operator: T) -> TypeNodeId {
        if !self.recovers {
            self.refuse(Refusal::Reported);
            return TypeNodeId::NONE;
        }
        let full = self.full_start();
        let is_constructor = matches!(self.token(), T::New | T::Abstract);
        let ty = self.function_or_constructor_type();
        let code = match (is_constructor, operator == T::Bar) {
            (false, true) => 1385,
            (true, true) => 1386,
            (false, false) => 1387,
            (true, false) => 1388,
        };
        self.error(code, (full, self.prev_end()), &[]);
        ty
    }

    /// `parseTypeOperatorOrHigher`
    fn type_operator(&mut self) -> TypeNodeId {
        let start = self.pos();
        match self.token() {
            T::KeyOf => {
                self.next();
                let operand = self.nested_type_operator();
                self.finish_type(TypeNodeKind::Keyof(operand), start)
            }
            T::Readonly => {
                self.next();
                let operand = self.nested_type_operator();
                self.finish_type(TypeNodeKind::Readonly(operand), start)
            }
            T::Unique => {
                self.next();
                let operand_start = self.pos();
                let operand = self.nested_type_operator();
                match self.f.types.last() {
                    Some(&TypeNode {
                        kind: TypeNodeKind::Keyword(Keyword::Symbol),
                        pos,
                        ..
                    }) if pos == operand_start && operand.idx() + 1 == self.f.types.len() => {
                        self.f.types.pop();
                        self.finish_type(TypeNodeKind::UniqueSymbol, start)
                    }
                    // `checkGrammarTypeOperatorNode` reports it.
                    _ => self.finish_type(TypeNodeKind::Unique(operand), start),
                }
            }
            T::Infer => self.infer_type(),
            _ => {
                let saved = self.enter_context(0, ctx::DISALLOW_CONDITIONAL_TYPES);
                let ty = self.postfix_type();
                self.context = saved;
                ty
            }
        }
    }

    fn nested_type_operator(&mut self) -> TypeNodeId {
        if self.is_too_deep() {
            return TypeNodeId::NONE;
        }
        self.type_operator()
    }

    /// `parseInferType`
    fn infer_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        self.next();
        // `parseTypeParameterOfInferType`
        let (name, pos) = self.identifier();
        // `tryParseConstraintOfInferType`
        let constraint = match self.token() {
            T::Extends => self.try_parse(|p| {
                p.next();
                let saved = p.enter_context(ctx::DISALLOW_CONDITIONAL_TYPES, 0);
                let constraint = p.ty();
                p.context = saved;
                let is_constraint =
                    p.has_context(ctx::DISALLOW_CONDITIONAL_TYPES) || p.token() != T::Question;
                is_constraint.then_some(constraint)
            }),
            _ => None,
        };
        let param = self.f.add_type_param(TypeParam {
            name,
            pos,
            start: pos,
            end: self.prev_end(),
            constraint: constraint.unwrap_or(TypeNodeId::NONE),
            default: TypeNodeId::NONE,
            flags: Flags::empty(),
            modifiers: Span::EMPTY,
        });
        self.finish_type(TypeNodeKind::Infer(param), start)
    }

    /// `parsePostfixTypeOrHigher`
    fn postfix_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        let mut ty = self.non_array_type();
        while !self.newline_before() {
            match self.token() {
                T::OpenBracket => {
                    self.next();
                    if self.eat(T::CloseBracket) {
                        ty = self.finish_type(TypeNodeKind::Array(ty), start);
                    } else if self.recovers && !self.is_start_of_type(false) {
                        self.expected(T::CloseBracket);
                        ty = self.finish_type(TypeNodeKind::Array(ty), start);
                    } else {
                        let index = self.type_in_list();
                        self.expect(T::CloseBracket);
                        ty =
                            self.finish_type(TypeNodeKind::IndexedAccess { obj: ty, index }, start);
                    }
                }
                T::Question => {
                    let is_before_type = self.look_ahead(|p| {
                        p.next();
                        p.is_start_of_type(false)
                    });
                    if is_before_type {
                        return ty;
                    }
                    // A `JSDocNullableType`, which the checker reports unless it is an element of
                    // a tuple: see `take_back_nullable_type`.
                    self.next();
                    let kind = TypeNodeKind::JSDoc {
                        ty,
                        kind: JSDocTypeKind::Nullable,
                        is_postfix: true,
                    };
                    ty = self.finish_type(kind, start);
                    self.last_nullable_type = (ty, self.prev_end());
                }
                // A `JSDocNonNullableType`, which the checker reports.
                T::Exclamation => {
                    self.next();
                    let kind = TypeNodeKind::JSDoc {
                        ty,
                        kind: JSDocTypeKind::NonNullable,
                        is_postfix: true,
                    };
                    ty = self.finish_type(kind, start);
                }
                _ => break,
            }
        }
        ty
    }

    /// `isStartOfType`
    pub(crate) fn is_start_of_type(&mut self, is_in_parameter: bool) -> bool {
        if self.token() != T::OpenParen {
            return self.is_start_of_type_without_parenthesis(is_in_parameter);
        }
        // "Only consider '(' the start of a type if followed by ')', '...', an identifier, a
        // modifier, or something that starts a type."
        // A loop over the parentheses that follow each other, where TypeScript recurses.
        !is_in_parameter
            && self.look_ahead(|p| {
                loop {
                    p.next();
                    if p.token() == T::CloseParen || p.is_start_of_parameter() {
                        return true;
                    }
                    if p.token() != T::OpenParen {
                        return p.is_start_of_type_without_parenthesis(false);
                    }
                }
            })
    }

    /// `isStartOfType`, at any token but a `(`.
    fn is_start_of_type_without_parenthesis(&mut self, is_in_parameter: bool) -> bool {
        match self.token() {
            T::Any
            | T::Unknown
            | T::StringKeyword
            | T::NumberKeyword
            | T::BigIntKeyword
            | T::Boolean
            | T::Readonly
            | T::Symbol
            | T::Unique
            | T::Void
            | T::Undefined
            | T::Null
            | T::This
            | T::TypeOf
            | T::Never
            | T::OpenBrace
            | T::OpenBracket
            | T::LessThan
            | T::Bar
            | T::Ampersand
            | T::New
            | T::String
            | T::Number
            | T::BigInt
            | T::True
            | T::False
            | T::Object
            | T::Asterisk
            | T::Question
            | T::Exclamation
            | T::DotDotDot
            | T::Infer
            | T::Import
            | T::Asserts
            | T::NoSubstitutionTemplate
            | T::TemplateHead => true,
            T::Function => !is_in_parameter,
            T::Minus => !is_in_parameter && matches!(self.peek(), T::Number | T::BigInt),
            _ => self.is_identifier(),
        }
    }

    /// `isStartOfParameter`
    pub(crate) fn is_start_of_parameter(&mut self) -> bool {
        self.token() == T::DotDotDot
            || self.is_binding_identifier()
            || matches!(self.token(), T::OpenBracket | T::OpenBrace)
            || self.token().is_modifier()
            || self.token() == T::At
            || self.is_start_of_type_without_parenthesis(true)
    }

    /// `parseNonArrayType`
    fn non_array_type(&mut self) -> TypeNodeId {
        let keyword = match self.token() {
            T::Identifier => return self.type_reference(),
            T::Any => Keyword::Any,
            T::Unknown => Keyword::Unknown,
            T::StringKeyword => Keyword::String,
            T::NumberKeyword => Keyword::Number,
            T::BigIntKeyword => Keyword::BigInt,
            T::Symbol => Keyword::Symbol,
            T::Boolean => Keyword::Boolean,
            T::Undefined => Keyword::Undefined,
            T::Never => Keyword::Never,
            T::Object => Keyword::Object,
            T::Void => return self.token_type(TypeNodeKind::Keyword(Keyword::Void)),
            T::Null => return self.token_type(TypeNodeKind::Keyword(Keyword::Null)),
            T::True => return self.token_type(TypeNodeKind::BoolLit(true)),
            T::False => return self.token_type(TypeNodeKind::BoolLit(false)),
            T::String => return self.token_type(TypeNodeKind::StringLit(self.lx.atom)),
            T::NoSubstitutionTemplate => {
                self.piece_of_template_without_tag();
                return self.token_type(TypeNodeKind::StringLit(self.lx.atom));
            }
            T::Number => {
                let number = self.f.number(self.lx.number);
                return self.token_type(TypeNodeKind::NumberLit(number));
            }
            T::BigInt => {
                let kind = TypeNodeKind::BigIntLit {
                    text: self.lx.atom,
                    negative: false,
                };
                return self.token_type(kind);
            }
            T::Minus => {
                return match self.peek() {
                    T::Number | T::BigInt => self.negative_literal_type(),
                    _ => self.type_reference(),
                };
            }
            T::This => {
                let start = self.pos();
                let this = self.token_type(TypeNodeKind::Keyword(Keyword::This));
                if self.token() == T::Is && !self.newline_before() {
                    // `parseThisTypePredicate`
                    self.f.types.pop();
                    self.next();
                    let ty = self.ty();
                    let kind = TypeNodeKind::Predicate {
                        param: known::this,
                        ty,
                        asserts: false,
                    };
                    return self.finish_type(kind, start);
                }
                return this;
            }
            T::TypeOf => {
                return match self.peek() {
                    T::Import => self.import_type(),
                    _ => self.type_query(),
                };
            }
            T::OpenBrace => {
                return match self.look_ahead(Self::is_start_of_mapped_type) {
                    true => self.mapped_type(),
                    false => self.type_literal(),
                };
            }
            T::OpenBracket => return self.tuple_type(),
            T::OpenParen => {
                // `parseParenthesizedType`, which has no node.
                self.next();
                let ty = self.ty();
                self.expect(T::CloseParen);
                return ty;
            }
            T::Import => return self.import_type(),
            T::Asserts => {
                let is_predicate = self.look_ahead(|p| {
                    p.next();
                    let is_name = match p.recovers {
                        // `nextTokenIsIdentifierOrKeywordOnSameLine`
                        true => p.token().is_identifier_or_keyword(),
                        false => p.is_identifier() || p.token() == T::This,
                    };
                    is_name && !p.newline_before()
                });
                return match is_predicate {
                    true => self.asserts_type_predicate(),
                    false => self.type_reference(),
                };
            }
            T::TemplateHead => return self.template_type(),
            T::Asterisk
            | T::AsteriskEquals
            | T::Question
            | T::QuestionQuestion
            | T::Exclamation => return self.jsdoc_prefix_type(),
            _ => return self.type_reference(),
        };
        // `parseKeywordAndNoDot`
        if self.peek() == T::Dot {
            return self.type_reference();
        }
        self.token_type(TypeNodeKind::Keyword(keyword))
    }

    /// `parseJSDocAllType`, `parseJSDocNullableType`, `parseJSDocNonNullableType`: the checker
    /// reports them.
    #[cold]
    #[inline(never)]
    fn jsdoc_prefix_type(&mut self) -> TypeNodeId {
        let (token, start) = (self.token(), self.pos());
        // `ReScanAsteriskEqualsToken`, `ReScanQuestionToken`
        if matches!(token, T::AsteriskEquals | T::QuestionQuestion) {
            self.lx.end = start + 1;
        }
        self.next();
        // `parseJSDocUnknownOrNullableType` of TypeScript 5: a `?` by itself.
        let is_unknown_type = token == T::Question
            && self.options.dialect.typescript_5
            && matches!(
                self.token(),
                T::Comma | T::CloseBrace | T::CloseParen | T::GreaterThan | T::Equals | T::Bar
            );
        if matches!(token, T::Asterisk | T::AsteriskEquals) || is_unknown_type {
            // `checkJSDocTypeIsInJsFile`
            if !self.options.is_javascript {
                self.flag(DiagnosticKind::Grammar, 8020, (start, start + 1), &[]);
            }
            return self.add_type(TypeNodeKind::Keyword(Keyword::Any), start, start + 1);
        }
        let ty = self.nested_type_operator();
        let kind = match token {
            T::Exclamation => JSDocTypeKind::NonNullable,
            _ => JSDocTypeKind::Nullable,
        };
        let kind = TypeNodeKind::JSDoc {
            ty,
            kind,
            is_postfix: false,
        };
        self.finish_type(kind, start)
    }

    /// `parseAssertsTypePredicate`
    fn asserts_type_predicate(&mut self) -> TypeNodeId {
        let start = self.pos();
        self.next();
        let param = match self.token() {
            T::This => {
                self.next();
                known::this
            }
            _ if self.is_identifier() => {
                let name = self.lx.atom;
                self.note_identifier(name, start);
                self.next_after_name();
                name
            }
            _ => self.missing_identifier(0, 0).0,
        };
        let ty = match self.eat(T::Is) {
            true => self.ty(),
            false => TypeNodeId::NONE,
        };
        let kind = TypeNodeKind::Predicate {
            param,
            ty,
            asserts: true,
        };
        self.finish_type(kind, start)
    }

    /// `-1` or `-1n`, at the `-`.
    pub(crate) fn negative_literal_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        self.next();
        let kind = match self.token() {
            T::Number => TypeNodeKind::NumberLit(self.f.number(-self.lx.number)),
            T::BigInt => TypeNodeKind::BigIntLit {
                text: self.lx.atom,
                negative: true,
            },
            _ => {
                self.fail();
                return TypeNodeId::NONE;
            }
        };
        self.next();
        self.finish_type(kind, start)
    }

    /// `parseEntityName`, with reserved words allowed.
    fn entity_name(&mut self) -> Span<NameId> {
        let base = self.s.names.len();
        let first = match self.token().is_identifier_or_keyword() {
            true => self.identifier_name(),
            // "Type expected."
            false => self.missing_identifier(1110, 0),
        };
        self.note_identifier(first.0, first.1);
        self.s.names.push(first);
        // `checkTypeReferenceNode`: `A.<T>`
        if self.rest_of_entity_name() && !self.newline_before() {
            let dot = self.full_start().saturating_sub(1);
            self.flag(DiagnosticKind::Grammar, 8020, (dot, dot + 1), &[]);
        }
        let names = self.s.names.get(base..).unwrap_or_default();
        let name = self.f.entity_name(names.iter().copied());
        self.s.names.truncate(base);
        name
    }

    /// The loop of `parseEntityName`: pushes the names after the first on the stack of names.
    /// Whether it ends between the dot and the `<` of `A.<T>`.
    #[inline]
    fn rest_of_entity_name(&mut self) -> bool {
        while self.token() == T::Dot {
            self.next();
            let token = self.token();
            if token.is_identifier_or_keyword()
                && token != T::PrivateIdentifier
                && !self.newline_before()
            {
                self.s.names.push((self.lx.atom, self.lx.start));
                self.next_after_name();
                continue;
            }
            match self.name_after_dot_in_type() {
                Some(name) => self.s.names.push(name),
                None => return true,
            }
        }
        false
    }

    /// `parseRightSideOfDot(allowIdentifierNames, !allowPrivateIdentifiers)`. `None`: at a `<`,
    /// where `parseEntityName` does not call it.
    #[cold]
    #[inline(never)]
    fn name_after_dot_in_type(&mut self) -> Option<(Atom, u32)> {
        let token = self.token();
        // Flow, whose `typeof a.b` is read here, has neither rule.
        if token == T::LessThan && !self.is_flow {
            return None;
        }
        let is_word = token.is_identifier_or_keyword();
        let starts_something_else = is_word
            && self.newline_before()
            && !self.is_flow
            && self.is_followed_by_word_on_same_line();
        if starts_something_else && !self.recovers {
            self.refuse(Refusal::Reported);
        }
        if is_word && !starts_something_else {
            if token != T::PrivateIdentifier {
                return Some(self.identifier_name());
            }
            // `parsePrivateIdentifier`
            match self.recovers {
                true => self.next(),
                false => self.fail(),
            }
        }
        let at = self.full_start();
        if is_word {
            // "Report that we need an identifier. However, report it right after the dot"
            self.error(1003, (at, Diagnostic::NO_LENGTH), &[]);
        } else {
            self.missing_identifier(0, 0);
        }
        Some((known::empty, at))
    }

    /// `scanTypeMemberStart`, at a modifier: whether the list of members goes on with the token.
    fn scan_type_member_start(&mut self) -> bool {
        // "Eat up all modifiers, but hold on to the last one in case it is actually an identifier"
        while self.token().is_modifier() {
            self.next();
        }
        // "Index signatures and computed property names are type members"
        if self.token() == T::OpenBracket {
            return true;
        }
        if self.is_literal_property_name() {
            self.next();
        }
        matches!(
            self.token(),
            T::OpenParen | T::LessThan | T::Question | T::Colon | T::Comma
        ) || self.can_parse_semicolon()
    }

    /// `parseTypeArguments`, at the `<`, and `checkGrammarTypeArguments`.
    pub(crate) fn type_arguments(&mut self) -> IdList<TypeNodeId> {
        let (list, error) = self.type_arguments_unchecked();
        if let Some((at, code)) = error {
            self.flag(DiagnosticKind::Grammar, code, at, &[]);
        }
        list
    }

    /// After the expression of a heritage clause, or the name of a JSX element. `parseTypeArguments`
    /// does not rescan a `<<`. Babel's does.
    #[inline]
    pub(crate) fn is_at_type_arguments_of_heritage_element(&mut self) -> bool {
        if self.token() == T::LessThanLessThan && self.options.dialect.babel {
            self.lx.token = T::LessThan;
            self.lx.end = self.lx.start + 1;
        }
        self.token() == T::LessThan
    }

    /// `parseTypeArguments`, at the `<`: the list, and what `checkGrammarTypeArguments` reports
    /// about it where it is called.
    pub(crate) fn type_arguments_unchecked(
        &mut self,
    ) -> (IdList<TypeNodeId>, Option<GrammarError>) {
        if self.is_flow {
            return (self.flow_type_arguments(), None);
        }
        let less_than = self.pos();
        self.next();
        let base = self.s.ids.len();
        let error = self.type_argument_list(less_than);
        self.expect(T::GreaterThan);
        (self.take_ids(base), error)
    }

    /// `parseDelimitedList(PCTypeArguments, parseType)`, after the `<` at `less_than`: pushes the
    /// types on the stack of ids. "The list ends before any token that is neither a comma nor the
    /// start of a type", so it can be empty (1099) and can end with a comma (1009).
    pub(crate) fn type_argument_list(&mut self, less_than: u32) -> Option<GrammarError> {
        let base = self.s.ids.len();
        let lists = self.enter_list(ListKind::TypeArguments);
        let error = loop {
            if self.token() != T::Comma && !self.is_start_of_type(false) {
                break Some(match self.s.ids.len() == base {
                    // Up to the end of the token after the list, which is one character long.
                    true => ((less_than, self.pos() + 1), 1099),
                    false => ((self.prev_end() - 1, self.prev_end()), 1009),
                });
            }
            let ty = self.ty();
            self.s.ids.push(ty.0);
            if !self.eat(T::Comma) {
                break None;
            }
        };
        self.lists = lists;
        error
    }

    /// `parseType` where `isStartOfType` is asked first, as `isListElement` does: for it a reserved
    /// word starts no type, although it can be the name in a type reference.
    fn type_in_list(&mut self) -> TypeNodeId {
        // With recovery `is_at_element` has asked, and a comma is an element whose type is missing.
        if !self.recovers && !self.is_start_of_type(false) {
            self.fail();
            return TypeNodeId::NONE;
        }
        self.ty()
    }

    /// `parseTypeArgumentsOfTypeReference`
    #[inline]
    fn type_arguments_of_type_reference(&mut self, is_checked: bool) -> IdList<TypeNodeId> {
        if self.newline_before() {
            return IdList::EMPTY;
        }
        match self.token() {
            T::LessThan => {}
            // `ReScanLessThanToken`
            T::LessThanLessThan => {
                self.lx.token = T::LessThan;
                self.lx.end = self.lx.start + 1;
            }
            _ => return IdList::EMPTY,
        }
        self.type_arguments_checked_if(is_checked)
    }

    /// `parseTypeArguments`, at the `<`. `is_checked`: with `checkGrammarTypeArguments`.
    #[inline]
    fn type_arguments_checked_if(&mut self, is_checked: bool) -> IdList<TypeNodeId> {
        match is_checked {
            true => self.type_arguments(),
            false => self.type_arguments_unchecked().0,
        }
    }

    /// `parseTypeReference`
    fn type_reference(&mut self) -> TypeNodeId {
        let start = self.pos();
        let name = self.entity_name();
        let args = self.type_arguments_of_type_reference(true);
        self.finish_type(TypeNodeKind::Ref { name, args }, start)
    }

    /// `isListElement(PCHeritageClauseElement)`
    pub(crate) fn is_heritage_element(&mut self) -> bool {
        match self.token() {
            // `isValidHeritageClauseObjectLiteral`: `{}` is the body unless something follows that
            // can follow an element.
            T::OpenBrace => self.look_ahead(|p| {
                p.next();
                if p.token() != T::CloseBrace {
                    return true;
                }
                p.next();
                matches!(
                    p.token(),
                    T::Comma | T::OpenBrace | T::Extends | T::Implements
                )
            }),
            T::Extends => false,
            // `isHeritageClauseExtendsOrImplementsKeyword`
            T::Implements => !self.look_ahead(|p| {
                p.next();
                p.is_start_of_expression()
            }),
            T::LessThan if self.is_ecmascript => true,
            _ => self.is_start_of_left_hand_side_expression(),
        }
    }

    /// `parseDelimitedList(PCHeritageClauseElement, ..)`, after `extends` or `implements`: calls
    /// `element` for each, with its index. Returns their number, and the comma at the end of the
    /// list if there is one.
    pub(crate) fn heritage_elements(
        &mut self,
        mut element: impl FnMut(&mut Self, u32),
    ) -> (u32, Option<(u32, u32)>) {
        let (mut count, mut comma) = (0, None);
        let lists = self.enter_list(ListKind::HeritageClauseElement);
        while self.is_at_element(ListKind::HeritageClauseElement) {
            if !self.recovers && !self.is_heritage_element() {
                break;
            }
            let full = self.full_start();
            element(self, count);
            count += 1;
            comma = (self.token() == T::Comma).then_some((self.lx.start, self.lx.end));
            if self.has_failed()
                || !self.eat(T::Comma)
                    && !self.goes_on_without_comma(ListKind::HeritageClauseElement, full)
            {
                break;
            }
        }
        self.lists = lists;
        // `isListTerminator`
        if !matches!(self.token(), T::OpenBrace | T::Extends | T::Implements) {
            self.fail_unless_recovering();
        }
        (count, comma)
    }

    /// `parseExpressionWithTypeArguments` in a clause whose elements are types: any of an interface,
    /// `implements` of a class. `is_checked`: `checkTypeReferenceNode` gets to it.
    /// `not_entity_name`: what it says about `A?.B`.
    pub(crate) fn heritage_type(&mut self, is_checked: bool, not_entity_name: u32) -> TypeNodeId {
        let before = self.lx.mark();
        let reference = match self.recovers {
            // What type arguments have built is taken back if the expression goes on after them.
            true => self.try_parse(|p| p.heritage_entity_name(is_checked, not_entity_name)),
            false => self.heritage_entity_name(is_checked, not_entity_name),
        };
        match reference {
            Some(reference) => reference,
            None if self.has_failed() => TypeNodeId::NONE,
            // An error of its parser.
            None if self.is_flow => {
                self.refuse(Refusal::Reported);
                TypeNodeId::NONE
            }
            None => {
                self.lx.reset(before);
                self.heritage_expression(is_checked)
            }
        }
    }

    /// `heritage_type`, if `IsEntityNameExpression` is true of the expression. `None`: it is not,
    /// and without recovery only tokens have been read.
    #[inline]
    fn heritage_entity_name(
        &mut self,
        is_checked: bool,
        not_entity_name: u32,
    ) -> Option<TypeNodeId> {
        if !self.is_identifier() {
            return None;
        }
        let start = self.pos();
        let base = self.s.names.len();
        let first = self.identifier_name();
        self.s.names.push(first);
        let mut is_optional_chain = false;
        while matches!(self.token(), T::Dot | T::QuestionDot) {
            is_optional_chain |= self.token() == T::QuestionDot;
            self.next();
            let token = self.token();
            if !token.is_identifier_or_keyword()
                || token == T::PrivateIdentifier
                || self.newline_before() && self.is_followed_by_word_on_same_line()
            {
                self.s.names.truncate(base);
                return None;
            }
            self.s.names.push((self.lx.atom, self.lx.start));
            self.next_after_name();
        }
        // `parseMemberExpressionRest` and `parseCallExpressionRest` go on.
        if matches!(
            self.token(),
            T::OpenParen | T::OpenBracket | T::NoSubstitutionTemplate | T::TemplateHead
        ) || self.token() == T::Exclamation && !self.newline_before()
        {
            self.s.names.truncate(base);
            return None;
        }
        self.note_identifier(first.0, first.1);
        let names = self.s.names.get(base..).unwrap_or_default();
        let name = self.f.entity_name(names.iter().copied());
        self.s.names.truncate(base);
        if is_optional_chain && is_checked {
            let at = (start, self.prev_end());
            self.flag(DiagnosticKind::Checker, not_entity_name, at, &[]);
        }
        let mut args = IdList::EMPTY;
        if self.token() == T::LessThan {
            args = self.type_arguments_checked_if(is_checked);
            if matches!(
                self.token(),
                T::OpenParen
                    | T::OpenBracket
                    | T::Dot
                    | T::QuestionDot
                    | T::Exclamation
                    | T::NoSubstitutionTemplate
                    | T::TemplateHead
            ) && self.goes_on_after_type_arguments()
            {
                return None;
            }
        }
        Some(self.finish_type(TypeNodeKind::Ref { name, args }, start))
    }

    /// Whether `parseLeftHandSideExpressionOrHigher` takes the type arguments before the token and
    /// goes on with it (`canFollowTypeArgumentsInExpression`).
    #[cold]
    #[inline(never)]
    fn goes_on_after_type_arguments(&mut self) -> bool {
        if !self.recovers {
            self.refuse(Refusal::Reported);
            return false;
        }
        match self.token() {
            // In JavaScript no expression takes type arguments.
            _ if !self.has_type_arguments_in_expressions => false,
            // It starts an expression, and only on the next line it goes on with this one.
            T::OpenBracket => self.newline_before(),
            // On the next line it goes on with nothing.
            T::Exclamation => false,
            _ => true,
        }
    }

    /// `parseExpressionWithTypeArguments`, of an expression that is no entity name: the checker
    /// reports it.
    #[cold]
    #[inline(never)]
    fn heritage_expression(&mut self, is_checked: bool) -> TypeNodeId {
        let start = self.pos();
        let saved = self.enter_context(0, ctx::TYPE);
        let mut expr = self.left_hand_side_expression();
        self.context = saved;
        let mut args = IdList::EMPTY;
        if expr.idx() + 1 == self.f.exprs.len()
            && let Some(&Expr {
                kind:
                    ExprKind::Instantiation {
                        expr: instantiated,
                        type_args,
                    },
                ..
            }) = self.f.exprs.last()
            && self.f.parens.last().is_none_or(|last| last.0 != expr)
        {
            self.f.exprs.pop();
            (expr, args) = (instantiated, type_args);
        } else if self.token() == T::LessThan {
            args = self.type_arguments_checked_if(is_checked);
        }
        self.finish_type(TypeNodeKind::Heritage { expr, args }, start)
    }

    /// `parseHeritageClauses` of an interface, with what `checkGrammarInterfaceDeclaration` reports
    /// but for `implements`, which the checker finds in the text: the types of the first `extends`
    /// clause, and those of the other clauses.
    fn interface_heritage(&mut self) -> (IdList<TypeNodeId>, IdList<TypeNodeId>) {
        let mut extends = IdList::EMPTY;
        let mut others: Vec<TypeNodeId> = Vec::new();
        // The checker returns after 1172 or at `implements`.
        let (mut has_extends, mut is_checked) = (false, true);
        let lists = self.enter_list(ListKind::HeritageClauses);
        let mut is_first = true;
        while self.is_at_heritage_clause(std::mem::take(&mut is_first)) {
            let keyword = (self.lx.start, self.lx.end);
            let is_extends = self.token() == T::Extends;
            let is_first_extends = is_extends && !has_extends;
            if !is_first_extends && is_checked {
                is_checked = false;
                if is_extends {
                    self.flag(DiagnosticKind::Grammar, 1172, (keyword.0, 0), &[]);
                }
            }
            has_extends |= is_extends;
            self.next();
            let base = self.s.ids.len();
            let (count, comma) = self.heritage_elements(|p, _| {
                let ty = p.heritage_type(is_first_extends, 2499);
                p.s.ids.push(ty.0);
            });
            // `checkGrammarHeritageClause`
            match comma {
                _ if !is_checked => {}
                Some(comma) => self.flag(DiagnosticKind::Grammar, 1009, (comma.0, 0), &[]),
                None if count == 0 => {
                    let at = (keyword.1, keyword.1);
                    self.flag(DiagnosticKind::Grammar, 1097, at, &[b"extends"]);
                }
                None => {}
            }
            match is_first_extends {
                true => extends = self.take_ids(base),
                false => {
                    let types = self.s.ids.get(base..).unwrap_or_default();
                    others.extend(types.iter().map(|&ty| TypeNodeId(ty)));
                    self.s.ids.truncate(base);
                }
            }
        }
        self.lists = lists;
        (extends, self.f.list(&others))
    }

    /// `parseTypeQuery`
    pub(crate) fn type_query(&mut self) -> TypeNodeId {
        let start = self.pos();
        self.next();
        // `parseEntityName(allowReservedWords, nil)`
        let base = self.s.names.len();
        let first = match self.token().is_identifier_or_keyword() {
            true => self.identifier_name(),
            false => {
                let at = self.full_start();
                self.missing_identifier(0, 0);
                (known::empty, at)
            }
        };
        self.s.names.push(first);
        self.rest_of_entity_name();
        // No atom of a name that is missing is looked at.
        if self.has_failed() {
            self.s.names.truncate(base);
            return TypeNodeId::NONE;
        }
        // `a.b.c` as an expression.
        let mut expr = ExprId::NONE;
        for index in base..self.s.names.len() {
            let (name, pos) = self.s.names[index];
            let kind = match expr.is_none() {
                true if name == known::this => ExprKind::This,
                true => ExprKind::Ident(name),
                false => ExprKind::Dot {
                    obj: expr,
                    name,
                    name_pos: pos,
                    chain: Chain::No,
                },
            };
            // The name ends where its text ends: no name here has an escape.
            let end = pos + self.lx.text_of(name).len() as u32;
            expr = self.add_expr(kind, first.1, end);
        }
        for index in base..self.s.names.len() {
            let (name, pos) = self.s.names[index];
            self.note_identifier(name, pos);
        }
        let names = self.s.names.get(base..).unwrap_or_default();
        let name = self.f.entity_name(names.iter().copied());
        self.s.names.truncate(base);
        let has_type_arguments = self.token() == T::LessThan && !self.newline_before();
        let args = match has_type_arguments {
            true => self.type_arguments(),
            false => IdList::EMPTY,
        };
        let kind = TypeNodeKind::Typeof {
            name,
            args,
            has_type_arguments,
            expr,
        };
        self.finish_type(kind, start)
    }

    /// `parseImportType`
    fn import_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        let is_typeof = self.eat(T::TypeOf);
        self.expect(T::Import);
        self.expect(T::OpenParen);
        let (mut spec, spec_pos) = (self.lx.atom, self.pos());
        let before = self.lx.mark();
        // `IsLiteralImportTypeNode`
        let argument = match self.eat(T::String) && matches!(self.token(), T::Comma | T::CloseParen)
        {
            true => TypeNodeId::NONE,
            false => self.argument_of_import_type(before),
        };
        let (mut mode, mut attributes) = (ResolutionMode::None, ImportAttributesToken::None);
        if self.eat(T::Comma) {
            (mode, attributes) = self.attributes_of_import_type();
        }
        self.expect(T::CloseParen);
        if argument.is_none() {
            self.f.specifier_uses.push(SpecifierUse {
                spec,
                pos: spec_pos,
                kind: SpecifierKind::ImportType,
                mode,
            });
        }
        let mut name = Span::EMPTY;
        if self.eat(T::Dot) {
            // `parseEntityNameOfTypeReference`
            let base = self.s.names.len();
            match self.token().is_identifier_or_keyword() {
                true => {
                    let first = self.identifier_name();
                    self.s.names.push(first);
                }
                false => self.missing_qualifier_of_import_type(),
            }
            self.rest_of_entity_name();
            let names = self.s.names.get(base..).unwrap_or_default();
            if !names.is_empty() {
                name = self.f.entity_name(names.iter().copied());
            }
            self.s.names.truncate(base);
        }
        // `checkImportType` does not look at the list.
        let args = match argument.is_none() {
            true => self.type_arguments_of_type_reference(false),
            false => {
                (spec, mode) = (Atom::NONE, ResolutionMode::None);
                self.argument_in_place_of_type_arguments(argument)
            }
        };
        let kind = TypeNodeKind::Import {
            spec,
            name,
            args,
            is_typeof,
            mode,
            attributes,
        };
        self.finish_type(kind, start)
    }

    /// The argument of `import(..)`, which starts at `before`, unless it is nothing but a string:
    /// `getTypeFromImportTypeNode` reports it.
    #[cold]
    #[inline(never)]
    fn argument_of_import_type(&mut self, before: Mark) -> TypeNodeId {
        if self.has_failed() {
            return TypeNodeId::NONE;
        }
        self.lx.reset(before);
        let (start, is_string) = (self.pos(), self.token() == T::String);
        let argument = self.ty();
        if is_string
            && argument.idx() + 1 == self.f.types.len()
            && let Some(&TypeNode {
                kind: TypeNodeKind::StringLit(_),
                pos,
                ..
            }) = self.f.types.last()
            && pos == start
        {
            self.f.types.pop();
            return TypeNodeId::NONE;
        }
        let at = (start, self.prev_end());
        self.flag(DiagnosticKind::Checker, 1141, at, &[]);
        argument
    }

    /// The `args` of `import(argument)`: `checkImportType` looks at an argument that is no string.
    /// The tree has no place for the type arguments, which the token can be the `<` of.
    #[cold]
    #[inline(never)]
    fn argument_in_place_of_type_arguments(&mut self, argument: TypeNodeId) -> IdList<TypeNodeId> {
        let before = self.checkpoint();
        self.type_arguments_of_type_reference(false);
        self.forget_nodes(&before);
        self.f.list(&[argument])
    }

    /// `parseImportType`, after the comma: `{ with: { name: "value" } }`
    #[cold]
    #[inline(never)]
    fn attributes_of_import_type(&mut self) -> (ResolutionMode, ImportAttributesToken) {
        let open = self.pos();
        self.expect(T::OpenBrace);
        let attributes = match self.token() {
            T::With => ImportAttributesToken::With,
            T::Assert => {
                // An error of the native parser.
                let at = (self.pos(), 0);
                match self.options.dialect.typescript_5 {
                    true => self.flag(DiagnosticKind::Grammar, 2880, at, &[]),
                    false => self.error_and_go_on(2880, at, &[]),
                }
                ImportAttributesToken::Assert
            }
            // The token stays, and `import_attributes` goes on at it.
            _ => {
                self.error_at_token(1005, &[T::With.text()]);
                ImportAttributesToken::With
            }
        };
        let mode = self.import_attributes(true);
        self.eat(T::Comma);
        if !self.eat(T::CloseBrace) {
            self.unclosed_import_attributes(open);
        }
        (mode, attributes)
    }

    /// `parseIdentifierNameWithDiagnostic(Type_expected)` after `import(..).`, at no name.
    #[cold]
    #[inline(never)]
    fn missing_qualifier_of_import_type(&mut self) {
        let at = self.full_start();
        self.missing_identifier(1110, 0);
        // `NodeIsMissing(n.Qualifier)`: a missing name that none follows is no qualifier.
        if self.token() == T::Dot && self.peek() != T::LessThan {
            self.s.names.push((known::empty, at));
        }
    }

    /// `parseTemplateType`
    fn template_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        // The first text, then each type and the text after it.
        let base = self.s.ids.len();
        self.piece_of_template_without_tag();
        self.s.ids.push(self.lx.atom.0);
        self.next();
        loop {
            let ty = self.ty();
            // `parseLiteralOfTemplateSpan`
            if self.token() != T::CloseBrace {
                self.expected(T::CloseBrace);
                self.s.ids.push(ty.0);
                self.s.ids.push(known::empty.0);
                break;
            }
            self.lx.rescan_template_continuation();
            self.piece_of_template_without_tag();
            self.s.ids.push(ty.0);
            self.s.ids.push(self.lx.atom.0);
            let goes_on = self.token() == T::TemplateMiddle;
            self.next();
            if !goes_on {
                break;
            }
        }
        let parts = self.s.ids.get(base..).unwrap_or_default();
        let count = (parts.len() / 2) as u32;
        let first = self.f.ids.len() as u32;
        self.f.ids.extend(parts.iter().skip(1).step_by(2));
        self.f.ids.extend(parts.iter().step_by(2));
        self.s.ids.truncate(base);
        let kind = TypeNodeKind::Template {
            types: IdList::new(first, count),
            texts: IdList::new(first + count, count + 1),
        };
        self.finish_type(kind, start)
    }

    /// `parseTupleType`
    fn tuple_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        self.next();
        let base = self.s.tuple_elems.len();
        let lists = self.enter_list(ListKind::TupleElementTypes);
        while self.is_in_list(T::CloseBracket) && self.is_at_element(ListKind::TupleElementTypes) {
            let element = self.full_start();
            self.tuple_element();
            if !self.eat(T::Comma)
                && !self.goes_on_without_comma(ListKind::TupleElementTypes, element)
            {
                break;
            }
        }
        self.lists = lists;
        self.expect(T::CloseBracket);
        let elements = take_span!(self, tuple_elems, base);
        self.finish_type(TypeNodeKind::Tuple(elements), start)
    }

    /// `parseTupleElementNameOrTupleElementType`
    fn tuple_element(&mut self) {
        let start = self.pos();
        // `isTupleElementName`
        let is_named = self.look_ahead(|p| {
            p.eat(T::DotDotDot);
            if !p.token().is_identifier_or_keyword() {
                return false;
            }
            p.next();
            p.token() == T::Colon || p.eat(T::Question) && p.token() == T::Colon
        });
        let has_dots = self.eat(T::DotDotDot);
        let mut element = TupleElem {
            ty: TypeNodeId::NONE,
            written: TypeNodeId::NONE,
            member_type: TupleMemberType::Plain,
            name: Atom::NONE,
            optional: false,
            rest: has_dots,
            has_dots,
            start,
            end: 0,
        };
        if is_named {
            element.name = self.lx.atom;
            self.note_identifier(element.name, start);
            self.next_after_name();
            element.optional = self.eat(T::Question);
            self.expect(T::Colon);
            // `parseTupleElementType`
            let type_start = self.pos();
            let has_dots_before_type = self.eat(T::DotDotDot);
            element.ty = self.ty();
            element.written = element.ty;
            element.end = self.prev_end();
            if has_dots_before_type
                || has_dots && element.optional
                || self.last_nullable_type == (element.ty, element.end)
            {
                self.check_named_tuple_member(&mut element, type_start, has_dots_before_type);
            }
        } else {
            // `parseTupleElementType`: a `JSDocNullableType` that is the whole type is an
            // optional element.
            element.ty = self.type_in_list();
            if !has_dots && let Some(ty) = self.take_back_nullable_type(element.ty) {
                element.ty = ty;
                element.optional = true;
            }
            element.written = element.ty;
            element.end = self.prev_end();
        }
        self.s.tuple_elems.push(element);
    }

    /// `T`, if `ty` is the `T?` that ends with the previous token. Its node is removed.
    #[inline]
    fn take_back_nullable_type(&mut self, ty: TypeNodeId) -> Option<TypeNodeId> {
        if self.last_nullable_type != (ty, self.prev_end()) || ty.idx() + 1 != self.f.types.len() {
            return None;
        }
        let Some(&TypeNode {
            kind:
                TypeNodeKind::JSDoc {
                    ty: operand,
                    kind: JSDocTypeKind::Nullable,
                    is_postfix: true,
                },
            ..
        }) = self.f.types.last()
        else {
            return None;
        };
        self.f.types.pop();
        Some(operand)
    }

    /// `getTypeFromRestTypeNode`: the element type if `ty` is an array type, otherwise `ty`.
    fn rest_element_type(&self, ty: TypeNodeId) -> TypeNodeId {
        match self.f.types.get(ty.idx()) {
            Some(&TypeNode {
                kind: TypeNodeKind::Array(element),
                ..
            }) => element,
            _ => ty,
        }
    }

    /// `checkNamedTupleMember`, of `name: ...T`, `name: T?` and `...name?: T`. The type starts at
    /// `type_start`, with its dots.
    #[cold]
    #[inline(never)]
    fn check_named_tuple_member(
        &mut self,
        element: &mut TupleElem,
        type_start: u32,
        has_dots_before_type: bool,
    ) {
        let at = (type_start, element.end);
        if has_dots_before_type {
            element.member_type = TupleMemberType::Rest;
            self.flag(DiagnosticKind::Grammar, 5087, at, &[]);
            element.ty = self.rest_element_type(element.ty);
        } else if let Some(operand) = self.take_back_nullable_type(element.ty) {
            element.member_type = TupleMemberType::Optional;
            element.written = operand;
            self.flag(DiagnosticKind::Grammar, 5086, at, &[]);
            // `getTypeFromOptionalTypeNode`
            let undefined = TypeNodeKind::Keyword(Keyword::Undefined);
            let undefined = self.add_type(undefined, type_start, type_start);
            let members = self.f.list(&[operand, undefined]);
            element.ty = self.add_type(TypeNodeKind::Union(members), type_start, element.end);
        }
        if element.has_dots && element.optional {
            let at = (element.start, element.end);
            self.flag(DiagnosticKind::Grammar, 5085, at, &[]);
            // `getTupleElementFlags`: it is optional.
            element.rest = false;
            element.ty = self.rest_element_type(element.ty);
        }
    }

    /// `isStartOfMappedType`
    fn is_start_of_mapped_type(&mut self) -> bool {
        self.next();
        if matches!(self.token(), T::Plus | T::Minus) {
            self.next();
            return self.token() == T::Readonly;
        }
        if self.token() == T::Readonly {
            self.next();
        }
        if self.token() != T::OpenBracket {
            return false;
        }
        self.next();
        if !self.is_identifier() {
            return false;
        }
        self.next();
        self.token() == T::In
    }

    /// `parseMappedType`
    fn mapped_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        self.next();
        let (mut readonly, mut is_readonly_with_plus) = (MappedModifier::None, false);
        match self.token() {
            T::Readonly => {
                self.next();
                readonly = MappedModifier::Add;
            }
            T::Plus => {
                self.next();
                self.expect(T::Readonly);
                (readonly, is_readonly_with_plus) = (MappedModifier::Add, true);
            }
            T::Minus => {
                self.next();
                self.expect(T::Readonly);
                readonly = MappedModifier::Remove;
            }
            _ => {}
        }
        self.expect(T::OpenBracket);
        // `parseMappedTypeParameter`
        let (name, pos) = self.identifier_name();
        self.note_identifier(name, pos);
        self.expect(T::In);
        let constraint = self.ty();
        let param_end = self.prev_end();
        let name_ty = match self.eat(T::As) {
            true => self.ty(),
            false => TypeNodeId::NONE,
        };
        self.expect(T::CloseBracket);
        let (mut optional, mut is_optional_with_plus) = (MappedModifier::None, false);
        match self.token() {
            T::Question => {
                self.next();
                optional = MappedModifier::Add;
            }
            T::Plus => {
                self.next();
                self.expect(T::Question);
                (optional, is_optional_with_plus) = (MappedModifier::Add, true);
            }
            T::Minus => {
                self.next();
                self.expect(T::Question);
                optional = MappedModifier::Remove;
            }
            _ => {}
        }
        let ty = self.type_annotation();
        self.semicolon();
        let members = match self.token() {
            T::CloseBrace => Span::EMPTY,
            _ => self.members_after_mapped_type(),
        };
        self.expect(T::CloseBrace);
        let param = self.f.add_type_param(TypeParam {
            name,
            pos,
            start: pos,
            end: param_end,
            constraint,
            default: TypeNodeId::NONE,
            flags: Flags::empty(),
            modifiers: Span::EMPTY,
        });
        let mapped = self.f.add_mapped(Mapped {
            param,
            name_ty,
            ty,
            readonly,
            optional,
            is_readonly_with_plus,
            is_optional_with_plus,
            members,
        });
        self.finish_type(TypeNodeKind::Mapped(mapped), start)
    }

    /// The `parseList(PCTypeMembers, parseTypeMember)` of `parseMappedType`, and
    /// `checkGrammarMappedType`.
    #[cold]
    #[inline(never)]
    fn members_after_mapped_type(&mut self) -> Span<MemberId> {
        let members = self.type_member_list();
        let first = self.f.members.get(members.start as usize);
        // `GetErrorRangeForNode`
        let at = first
            .filter(|_| !members.is_empty())
            .map(|first| match first.kind {
                MemberKind::Property | MemberKind::Getter | MemberKind::Setter => {
                    (first.name_pos, 0)
                }
                _ => (first.start, first.loc.end),
            });
        if let Some(at) = at {
            self.flag(DiagnosticKind::Grammar, 7061, at, &[]);
        }
        members
    }

    /// `parseTypeLiteral`
    fn type_literal(&mut self) -> TypeNodeId {
        let start = self.pos();
        let members = self.object_type_members();
        self.finish_type(TypeNodeKind::Object(members), start)
    }

    /// `parseObjectTypeMembers`, at the `{`.
    fn object_type_members(&mut self) -> Span<MemberId> {
        if !self.expect(T::OpenBrace) {
            return Span::EMPTY;
        }
        let members = self.type_member_list();
        self.expect(T::CloseBrace);
        members
    }

    /// `parseList(PCTypeMembers, parseTypeMember)`
    #[inline]
    fn type_member_list(&mut self) -> Span<MemberId> {
        let base = self.s.members.len();
        let lists = self.enter_list(ListKind::TypeMembers);
        while self.is_in_list(T::CloseBrace) && self.is_at_element(ListKind::TypeMembers) {
            let member = self.type_member();
            self.s.members.push(member);
        }
        self.lists = lists;
        take_span!(self, members, base)
    }

    /// `parseTypeMemberSemicolon`
    fn type_member_semicolon(&mut self) {
        // "We allow type members to be separated by commas or (possibly ASI) semicolons."
        if !self.eat(T::Comma) {
            self.semicolon();
        }
    }

    /// `isIndexSignature`, at a `[`.
    pub(crate) fn is_index_signature(&mut self) -> bool {
        // `isUnambiguouslyIndexSignature`
        self.look_ahead(|p| {
            p.next();
            if matches!(p.token(), T::DotDotDot | T::CloseBracket) {
                return true;
            }
            if p.token().is_modifier() {
                p.next();
                if p.is_identifier() {
                    return true;
                }
            } else if !p.is_identifier() {
                return false;
            } else {
                p.next();
            }
            if matches!(p.token(), T::Colon | T::Comma) {
                return true;
            }
            if p.token() != T::Question {
                return false;
            }
            p.next();
            matches!(p.token(), T::Colon | T::Comma | T::CloseBracket)
        })
    }

    /// `checkGrammarIndexSignatureParameters`, up to the check of the type of the parameter.
    /// `comma`: the one at the end of the list. `member`: from the start to the end of the signature.
    fn check_index_signature_parameters(
        &mut self,
        params: Span<ParamId>,
        comma: Option<u32>,
        member: (u32, u32),
    ) {
        if self.has_failed() {
            return;
        }
        let Some(&first) = self
            .f
            .params
            .get(params.start as usize)
            .filter(|_| !params.is_empty())
        else {
            return self.flag(DiagnosticKind::Grammar, 1096, member, &[]);
        };
        let name = self.f.pats.get(first.pat.idx()).map_or(0, |it| it.pos);
        if params.len() != 1 {
            return self.flag(DiagnosticKind::Grammar, 1096, (name, 0), &[]);
        }
        if let Some(comma) = comma {
            self.flag(DiagnosticKind::Grammar, 1025, (comma, 0), &[]);
        }
        let error = if first.flags.contains(Flags::REST) {
            Some((first.pos, 1017))
        } else if first.pos != name {
            Some((name, 1018))
        } else if first.flags.contains(Flags::OPTIONAL) {
            Some((self.question_of_parameter, 1019))
        } else if first.default.is_some() {
            Some((name, 1020))
        } else if first.ty.is_none() {
            Some((name, 1022))
        } else {
            None
        };
        if let Some((at, code)) = error {
            self.flag(DiagnosticKind::Grammar, code, (at, 0), &[]);
        }
    }

    /// `parseIndexSignatureDeclaration`, at the `[`.
    pub(crate) fn index_signature(
        &mut self,
        start: Start,
        flags: Flags,
        modifiers: Span<ModifierId>,
    ) -> Member {
        let bracket = self.pos();
        self.next();
        let saved = self.enter_context(ctx::TYPE, 0);
        let params = self.parameter_list(0, T::CloseBracket);
        let last = self.prev_end().saturating_sub(1);
        let comma =
            (!params.is_empty() && self.lx.src.get(last as usize) == Some(&b',')).then_some(last);
        self.expect(T::CloseBracket);
        let ty = self.type_annotation();
        self.context = saved;
        self.type_member_semicolon();
        self.check_index_signature_parameters(params, comma, (start.pos, self.prev_end()));
        let func = self.f.add_fn(Func {
            kind: FnKind::IndexSignature,
            flags,
            name: Atom::NONE,
            name_pos: bracket,
            type_params: Span::EMPTY,
            params,
            this_param: ParamId::NONE,
            ret: ty,
            body: FnBody::None,
            anchor: bracket,
            start: start.pos,
        });
        Member {
            kind: MemberKind::IndexSignature,
            key: PropKey::None,
            flags,
            ty,
            init: ExprId::NONE,
            func,
            name_pos: start.pos,
            start: start.pos,
            loc: TextRange {
                pos: start.full,
                end: self.prev_end(),
            },
            modifiers,
        }
    }

    /// From the type parameters of a signature to its return type.
    fn signature(
        &mut self,
        kind: FnKind,
        flags: Flags,
        name: Atom,
        name_pos: u32,
        start: u32,
    ) -> FnId {
        let type_params = self.type_parameters();
        let anchor = match self.token() {
            T::OpenParen => self.pos(),
            // `createMissingList`
            _ => self.full_start().saturating_sub(1),
        };
        let (this_param, params) = self.parameters(0);
        // `shouldParseReturnType`: "This is easy to get backward, especially in type contexts, so
        // parse the type anyway"
        if self.token() == T::EqualsGreaterThan
            && self.recovers
            && !matches!(kind, FnKind::Getter | FnKind::Setter)
        {
            self.expected(T::Colon);
            self.lx.token = T::Colon;
        }
        let ret = match self.eat(T::Colon) {
            true => self.type_or_type_predicate(),
            false => TypeNodeId::NONE,
        };
        self.f.add_fn(Func {
            kind,
            flags,
            name,
            name_pos,
            type_params,
            params,
            this_param,
            ret,
            body: FnBody::None,
            anchor,
            start,
        })
    }

    /// `parseTypeMember`
    fn type_member(&mut self) -> Member {
        let start = self.start();
        let mut member = Member {
            kind: MemberKind::Property,
            key: PropKey::None,
            flags: Flags::empty(),
            ty: TypeNodeId::NONE,
            init: ExprId::NONE,
            func: FnId::NONE,
            name_pos: start.pos,
            start: start.pos,
            loc: TextRange::default(),
            modifiers: Span::EMPTY,
        };
        let signature_kind = match self.token() {
            T::OpenParen | T::LessThan => Some((MemberKind::CallSignature, FnKind::CallSignature)),
            T::New if matches!(self.peek(), T::OpenParen | T::LessThan) => {
                self.next();
                Some((MemberKind::ConstructSignature, FnKind::ConstructSignature))
            }
            _ => None,
        };
        if let Some((kind, fn_kind)) = signature_kind {
            member.kind = kind;
            member.func = self.signature(fn_kind, Flags::empty(), Atom::NONE, start.pos, start.pos);
        } else {
            let first_modifier = self.s.modifiers.len();
            if self.token().is_modifier() {
                // With recovery `is_at_element` has asked.
                if !self.recovers && !self.look_ahead(Self::scan_type_member_start) {
                    self.fail();
                }
                member.flags = self.modifiers(ModifiersOf::TypeMember);
            }
            member.modifiers = self.take_modifiers(first_modifier);
            let mut fn_kind = FnKind::Method;
            if matches!(self.token(), T::Get | T::Set) {
                // `parseContextualModifier`
                let accessor = self.token();
                let mark = self.lx.mark();
                self.next();
                if self.can_follow_accessor_keyword() {
                    (member.kind, fn_kind) = match accessor {
                        T::Get => (MemberKind::Getter, FnKind::Getter),
                        _ => (MemberKind::Setter, FnKind::Setter),
                    };
                } else {
                    self.lx.reset(mark);
                }
            }
            if member.kind == MemberKind::Property
                && self.token() == T::OpenBracket
                && self.is_index_signature()
            {
                return self.index_signature(start, member.flags, member.modifiers);
            }
            // `parsePropertyOrMethodSignature`
            let name_token = self.token();
            let (mut key, name_kind, name_pos) = self.property_name();
            // `getDeclarationName`: a bigint name declares nothing.
            if name_token == T::BigInt {
                key = PropKey::None;
            }
            // `getDeclarationName`: a private name outside a class declares nothing.
            if self.classes_around == 0 && matches!(key, PropKey::Private(_)) {
                key = PropKey::None;
            }
            (member.key, member.name_pos) = (key, name_pos);
            match name_kind {
                NameKind::StringLiteral => member.flags |= Flags::STRING_NAME,
                NameKind::NumericLiteral => member.flags |= Flags::LITERAL_NAME,
                NameKind::ComputedString if matches!(key, PropKey::Name(_)) => {
                    member.flags |= Flags::STRING_NAME | Flags::COMPUTED_NAME;
                }
                _ if name_token == T::OpenBracket => member.flags |= Flags::COMPUTED_NAME,
                _ => {}
            }
            // `parseAccessorDeclaration` takes none.
            if member.kind == MemberKind::Property && self.eat(T::Question) {
                member.flags |= Flags::OPTIONAL;
            }
            if member.kind != MemberKind::Property
                || matches!(self.token(), T::OpenParen | T::LessThan)
            {
                if member.kind == MemberKind::Property {
                    member.kind = MemberKind::Method;
                }
                let name = key.name().unwrap_or(Atom::NONE);
                let flags = member.flags - Flags::LITERAL_NAME;
                member.func = self.signature(fn_kind, flags, name, name_pos, start.pos);
                // `parseFunctionBlockOrSemicolon`: nothing has to follow a body.
                if self.token() == T::OpenBrace && self.body_in_type(member.kind, member.func) {
                    member.loc = TextRange {
                        pos: start.full,
                        end: self.prev_end(),
                    };
                    return member;
                }
            } else {
                member.ty = self.type_annotation();
                // The checker reports it. `scanTypeMemberStart`: no member starts with `a =`.
                if member.ty.is_some() || member.flags.contains(Flags::OPTIONAL) {
                    let saved = self.enter_context(0, ctx::TYPE);
                    member.init = self.optional_initializer();
                    self.context = saved;
                }
            }
        }
        self.type_member_semicolon();
        member.loc = TextRange {
            pos: start.full,
            end: self.prev_end(),
        };
        member
    }

    /// At the `{` after the signature `func` of a member of a type. Whether it is an accessor,
    /// which `parseAccessorDeclaration` gives a body: `checkGrammarAccessor` reports it.
    #[cold]
    #[inline(never)]
    fn body_in_type(&mut self, kind: MemberKind, func: FnId) -> bool {
        if !matches!(kind, MemberKind::Getter | MemberKind::Setter) {
            // `parseTypeMemberSemicolon` reports the `{`.
            if !self.recovers {
                self.refuse(Refusal::Reported);
            }
            return false;
        }
        let saved = self.enter_context(0, ctx::TYPE);
        let (body, open) = self.function_block(0);
        self.context = saved;
        if let Some(accessor) = self.f.fns.get_mut(func.idx()) {
            accessor.body = body;
        }
        self.f.body_starts.push((func, open));
        let at = (open, self.prev_end());
        self.flag(DiagnosticKind::Grammar, 1183, at, &[]);
        true
    }

    // ───────────────────────────── declarations ─────────────────────────────

    /// `parseInterfaceDeclaration`
    pub(crate) fn interface_declaration(
        &mut self,
        start: Start,
        base: usize,
        flags: Flags,
    ) -> StmtId {
        self.next();
        let (name, name_pos) = self.identifier();
        let saved = self.enter_context(ctx::TYPE, 0);
        let type_params = self.type_parameters();
        let (extends, other_heritage) = self.interface_heritage();
        let members = self.object_type_members();
        self.context = saved;
        let interface = self.f.add_interface(Interface {
            name,
            name_pos,
            flags: flags | self.ambient(),
            type_params,
            extends,
            other_heritage,
            members,
            stmt: StmtId::NONE,
        });
        let modifiers = self.take_modifiers(base);
        let statement = self.add_stmt(StmtKind::Interface(interface), start, modifiers);
        self.f[interface].stmt = statement;
        statement
    }

    /// `parseTypeAliasDeclaration`
    pub(crate) fn type_alias_declaration(
        &mut self,
        start: Start,
        base: usize,
        flags: Flags,
    ) -> StmtId {
        self.next();
        // After `declare type` a line break is possible, and an error.
        if self.newline_before() {
            self.error_and_go_on(1142, self.range_of_token(), &[]);
        }
        let (name, name_pos) = self.identifier();
        let saved = self.enter_context(ctx::TYPE, 0);
        let type_params = self.type_parameters();
        self.context = saved;
        self.expect(T::Equals);
        let ty = match self.token() {
            T::Intrinsic if self.peek() != T::Dot => {
                self.token_type(TypeNodeKind::Keyword(Keyword::Intrinsic))
            }
            _ => self.ty(),
        };
        self.semicolon();
        let alias = self.f.add_alias(Alias {
            name,
            name_pos,
            flags: flags | self.ambient(),
            type_params,
            ty,
            stmt: StmtId::NONE,
        });
        let modifiers = self.take_modifiers(base);
        let statement = self.add_stmt(StmtKind::TypeAlias(alias), start, modifiers);
        self.f[alias].stmt = statement;
        statement
    }
}
