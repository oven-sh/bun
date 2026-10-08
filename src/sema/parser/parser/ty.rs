//! Types, and the declarations that consist of types.

use super::stmt::Start;
use super::{Parser, ctx, take_span};
use crate::Refusal;
use crate::token::T;
use bun_sema::atom::{Atom, known};
use bun_sema::hir::*;

impl Parser<'_> {
    #[inline(always)]
    fn add_type(&mut self, kind: TypeNodeKind, pos: u32, end: u32) -> TypeNodeId {
        let id = TypeNodeId(self.f.types.len() as u32);
        self.f.types.push(TypeNode { kind, pos, end });
        id
    }

    /// A type that ends with the previous token.
    #[inline(always)]
    fn finish_type(&mut self, kind: TypeNodeKind, pos: u32) -> TypeNodeId {
        let end = self.prev_end();
        self.add_type(kind, pos, end)
    }

    /// A type that is the token, which is consumed.
    #[inline(always)]
    fn token_type(&mut self, kind: TypeNodeKind) -> TypeNodeId {
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
        self.ty()
    }

    /// `parseType`
    pub(crate) fn ty(&mut self) -> TypeNodeId {
        if self.is_too_deep() {
            return TypeNodeId::NONE;
        }
        self.typescript_only();
        // `TypeExcludesFlags`
        let saved = self.enter_context(0, ctx::YIELD | ctx::AWAIT);
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
            T::OpenParen => self.look_ahead_parsing(Self::is_unambiguously_start_of_function_type),
            T::Abstract => self.peek() == T::New,
            _ => false,
        }
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
            self.modifiers(false, false, false);
            self.s.modifiers.truncate(base);
        }
        if self.is_identifier() || self.token() == T::This {
            self.next();
        } else if matches!(self.token(), T::OpenBracket | T::OpenBrace) {
            self.identifier_or_pattern();
            if self.has_failed() {
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
        let first = self.intersection_type();
        if self.token() != T::Bar && !has_leading_operator {
            return first;
        }
        let base = self.s.ids.len();
        self.s.ids.push(first.0);
        while self.eat(T::Bar) {
            let member = self.intersection_type();
            self.s.ids.push(member.0);
        }
        let members = self.take_ids(base);
        self.finish_type(TypeNodeKind::Union(members), start)
    }

    /// `parseIntersectionTypeOrHigher`
    fn intersection_type(&mut self) -> TypeNodeId {
        let start = self.pos();
        let has_leading_operator = self.eat(T::Ampersand);
        let first = self.constituent_type();
        if self.token() != T::Ampersand && !has_leading_operator {
            return first;
        }
        let base = self.s.ids.len();
        self.s.ids.push(first.0);
        while self.eat(T::Ampersand) {
            let member = self.constituent_type();
            self.s.ids.push(member.0);
        }
        let members = self.take_ids(base);
        self.finish_type(TypeNodeKind::Intersection(members), start)
    }

    /// A member of a union or an intersection. `parseFunctionOrConstructorTypeToError`: a function
    /// type has to be in parentheses there.
    #[inline]
    fn constituent_type(&mut self) -> TypeNodeId {
        if matches!(self.token(), T::LessThan | T::New) {
            self.refuse(Refusal::Reported);
        }
        self.type_operator()
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
                    _ => {
                        self.report();
                        self.finish_type(TypeNodeKind::Unique(operand), start)
                    }
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
                    } else {
                        let index = self.type_in_list();
                        self.expect(T::CloseBracket);
                        ty = self.finish_type(TypeNodeKind::IndexedAccess { obj: ty, index }, start);
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
                    // A `JSDocNullableType`, which only an element of a tuple can be: see
                    // `tuple_element`.
                    self.next();
                    self.unclaimed_nullable_types += 1;
                    self.last_nullable_type = (ty, self.prev_end());
                }
                // A `JSDocNonNullableType`
                T::Exclamation => {
                    self.report();
                    self.next();
                }
                _ => break,
            }
        }
        ty
    }

    /// `isStartOfType`
    pub(crate) fn is_start_of_type(&mut self, is_in_parameter: bool) -> bool {
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
            // "Only consider '(' the start of a type if followed by ')', '...', an identifier, a
            // modifier, or something that starts a type."
            // A loop over the parentheses that follow each other, where TypeScript recurses.
            T::OpenParen => {
                !is_in_parameter
                    && self.look_ahead(|p| {
                        loop {
                            p.next();
                            if p.token() == T::CloseParen || p.is_start_of_parameter() {
                                return true;
                            }
                            if p.token() != T::OpenParen {
                                return p.is_start_of_type(false);
                            }
                        }
                    })
            }
            _ => self.is_identifier(),
        }
    }

    /// `isStartOfParameter`
    fn is_start_of_parameter(&mut self) -> bool {
        self.token() == T::DotDotDot
            || self.is_binding_identifier()
            || matches!(self.token(), T::OpenBracket | T::OpenBrace)
            || self.token().is_modifier()
            || self.token() == T::At
            || self.is_start_of_type(true)
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
                return self.finish_type(kind, start);
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
                    (p.is_identifier() || p.token() == T::This) && !p.newline_before()
                });
                return match is_predicate {
                    true => self.asserts_type_predicate(),
                    false => self.type_reference(),
                };
            }
            T::TemplateHead => return self.template_type(),
            // The types of JSDoc.
            T::Asterisk
            | T::AsteriskEquals
            | T::Question
            | T::QuestionQuestion
            | T::Exclamation
            | T::Function => {
                self.refuse(Refusal::Reported);
                return TypeNodeId::NONE;
            }
            _ => return self.type_reference(),
        };
        // `parseKeywordAndNoDot`
        if self.peek() == T::Dot {
            return self.type_reference();
        }
        self.token_type(TypeNodeKind::Keyword(keyword))
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
            _ => {
                let name = self.lx.atom;
                self.note_identifier(name, start);
                self.next();
                name
            }
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

    /// `parseEntityName`, with reserved words allowed.
    fn entity_name(&mut self) -> Span<NameId> {
        let base = self.s.names.len();
        let first = self.identifier_name();
        self.note_identifier(first.0, first.1);
        self.s.names.push(first);
        while self.token() == T::Dot {
            self.next();
            if self.newline_before()
                && self.token().is_identifier_or_keyword()
                && self.is_followed_by_word_on_same_line()
            {
                self.refuse(Refusal::Reported);
            }
            let name = self.identifier_name();
            self.s.names.push(name);
        }
        let names = self.s.names.get(base..).unwrap_or_default();
        let name = self.f.entity_name(names.iter().copied());
        self.s.names.truncate(base);
        name
    }

    /// `parseTypeArguments`, at the `<`.
    pub(crate) fn type_arguments(&mut self) -> IdList<TypeNodeId> {
        self.next();
        let base = self.s.ids.len();
        while self.is_in_list(T::GreaterThan) {
            let ty = self.type_in_list();
            self.s.ids.push(ty.0);
            if !self.eat(T::Comma) {
                break;
            }
            // A comma at the end is an error.
            if self.token() == T::GreaterThan {
                self.report();
            }
        }
        if self.s.ids.len() == base {
            // An empty list is an error.
            self.refuse(Refusal::Reported);
        }
        self.expect(T::GreaterThan);
        self.take_ids(base)
    }

    /// `parseType` where `isStartOfType` is asked first, as `isListElement` does: for it a reserved
    /// word starts no type, although it can be the name in a type reference.
    pub(crate) fn type_in_list(&mut self) -> TypeNodeId {
        if !self.is_start_of_type(false) {
            self.fail();
            return TypeNodeId::NONE;
        }
        self.ty()
    }

    /// `parseTypeArgumentsOfTypeReference`
    #[inline]
    fn type_arguments_of_type_reference(&mut self) -> IdList<TypeNodeId> {
        if self.newline_before() {
            return IdList::EMPTY;
        }
        match self.token() {
            T::LessThan => self.type_arguments(),
            // `ReScanLessThanToken`
            T::LessThanLessThan => {
                self.lx.token = T::LessThan;
                self.lx.end = self.lx.start + 1;
                self.type_arguments()
            }
            _ => IdList::EMPTY,
        }
    }

    /// `parseTypeReference`
    fn type_reference(&mut self) -> TypeNodeId {
        let start = self.pos();
        let name = self.entity_name();
        let args = self.type_arguments_of_type_reference();
        self.finish_type(TypeNodeKind::Ref { name, args }, start)
    }

    /// The elements of an `implements` clause, or of the `extends` clause of an interface.
    pub(crate) fn heritage_types(&mut self) -> IdList<TypeNodeId> {
        let base = self.s.ids.len();
        loop {
            // Anything but an entity name is an error. `isHeritageClauseExtendsOrImplementsKeyword`:
            // either keyword can end the list.
            if !self.is_identifier() || matches!(self.token(), T::Extends | T::Implements) {
                self.refuse(Refusal::Reported);
            }
            let start = self.pos();
            let name = self.entity_name();
            let args = match self.token() {
                T::LessThan => self.type_arguments(),
                _ => IdList::EMPTY,
            };
            if matches!(
                self.token(),
                T::OpenParen | T::OpenBracket | T::QuestionDot | T::Exclamation
            ) {
                self.refuse(Refusal::Reported);
            }
            let ty = self.finish_type(TypeNodeKind::Ref { name, args }, start);
            self.s.ids.push(ty.0);
            if !self.eat(T::Comma) {
                break;
            }
        }
        self.take_ids(base)
    }

    /// `parseTypeQuery`
    fn type_query(&mut self) -> TypeNodeId {
        let start = self.pos();
        self.next();
        let base = self.s.names.len();
        let first = self.identifier_name();
        self.s.names.push(first);
        while self.eat(T::Dot) {
            let name = self.identifier_name();
            self.s.names.push(name);
        }
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
        if self.token() != T::String {
            self.refuse(Refusal::Reported);
        }
        let (spec, spec_pos) = (self.lx.atom, self.pos());
        self.next();
        if self.token() == T::Comma {
            self.refuse(Refusal::Unsupported);
        }
        self.expect(T::CloseParen);
        self.f.specifier_uses.push(SpecifierUse {
            spec,
            pos: spec_pos,
            kind: SpecifierKind::ImportType,
            mode: ResolutionMode::None,
        });
        let mut name = Span::EMPTY;
        if self.eat(T::Dot) {
            let base = self.s.names.len();
            loop {
                let part = self.identifier_name();
                self.s.names.push(part);
                if !self.eat(T::Dot) {
                    break;
                }
            }
            let names = self.s.names.get(base..).unwrap_or_default();
            name = self.f.entity_name(names.iter().copied());
            self.s.names.truncate(base);
        }
        let args = self.type_arguments_of_type_reference();
        let kind = TypeNodeKind::Import {
            spec,
            name,
            args,
            is_typeof,
            mode: ResolutionMode::None,
            attributes: ImportAttributesToken::None,
        };
        self.finish_type(kind, start)
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
            if self.token() != T::CloseBrace {
                self.fail();
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
        while self.is_in_list(T::CloseBracket) {
            self.tuple_element();
            if !self.eat(T::Comma) {
                break;
            }
        }
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
        let (mut name, mut optional) = (Atom::NONE, false);
        let ty;
        if is_named {
            name = self.lx.atom;
            self.note_identifier(name, start);
            self.next();
            optional = self.eat(T::Question);
            self.expect(T::Colon);
            if has_dots && optional || self.token() == T::DotDotDot {
                self.refuse(Refusal::Reported);
            }
            ty = self.ty();
        } else {
            // `parseTupleElementType`: a `JSDocNullableType` that is the whole type is an
            // optional element.
            ty = self.type_in_list();
            if self.unclaimed_nullable_types > 0 && self.last_nullable_type == (ty, self.prev_end())
            {
                self.unclaimed_nullable_types -= 1;
                self.last_nullable_type = (TypeNodeId::NONE, 0);
                optional = true;
                if has_dots {
                    self.refuse(Refusal::Reported);
                }
            }
        }
        self.s.tuple_elems.push(TupleElem {
            ty,
            written: ty,
            member_type: TupleMemberType::Plain,
            name,
            optional,
            rest: has_dots,
            has_dots,
            start,
            end: self.prev_end(),
        });
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
        // Members after it are an error.
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
            members: Span::EMPTY,
        });
        self.finish_type(TypeNodeKind::Mapped(mapped), start)
    }

    /// `parseTypeLiteral`
    fn type_literal(&mut self) -> TypeNodeId {
        let start = self.pos();
        let members = self.object_type_members();
        self.finish_type(TypeNodeKind::Object(members), start)
    }

    /// `parseObjectTypeMembers`, at the `{`.
    fn object_type_members(&mut self) -> Span<MemberId> {
        self.expect(T::OpenBrace);
        let base = self.s.members.len();
        while self.is_in_list(T::CloseBrace) {
            let member = self.type_member();
            self.s.members.push(member);
        }
        self.expect(T::CloseBrace);
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

    /// `parseIndexSignatureDeclaration`, at the `[`.
    pub(crate) fn index_signature(
        &mut self,
        start: Start,
        flags: Flags,
        modifiers: Span<ModifierId>,
    ) -> Member {
        let bracket = self.pos();
        self.next();
        let params = self.parameter_list(0, T::CloseBracket);
        self.expect(T::CloseBracket);
        // `checkGrammarIndexSignatureParameters`
        let is_plain = params.len() == 1
            && self.f.params.get(params.start as usize).is_some_and(|it| {
                it.flags.is_empty() && it.default.is_none() && it.ty.is_some()
            })
            && self.lx.src.get(self.prev_end() as usize - 2) != Some(&b',');
        if !is_plain {
            self.refuse(Refusal::Reported);
        }
        let ty = self.type_annotation();
        self.type_member_semicolon();
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
        let anchor = self.pos();
        let (this_param, params) = self.parameters(0);
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
            member.func =
                self.signature(fn_kind, Flags::empty(), Atom::NONE, start.pos, start.pos);
        } else {
            let first_modifier = self.s.modifiers.len();
            if self.token().is_modifier() {
                member.flags = self.modifiers(false, false, false);
                if member.flags != Flags::READONLY && !member.flags.is_empty() {
                    self.refuse(Refusal::Reported);
                }
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
            if name_token == T::BigInt {
                self.refuse(Refusal::Unsupported);
            }
            let (mut key, name_kind, name_pos) = self.property_name();
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
            if self.eat(T::Question) {
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
                if self.token() == T::OpenBrace {
                    self.refuse(Refusal::Reported);
                }
            } else {
                member.ty = self.type_annotation();
                if self.token() == T::Equals {
                    self.refuse(Refusal::Reported);
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
        let type_params = self.type_parameters();
        let extends = match self.eat(T::Extends) {
            true => self.heritage_types(),
            false => IdList::EMPTY,
        };
        if matches!(self.token(), T::Extends | T::Implements) {
            self.refuse(Refusal::Reported);
        }
        let members = self.object_type_members();
        let interface = self.f.add_interface(Interface {
            name,
            name_pos,
            flags: flags | self.ambient(),
            type_params,
            extends,
            other_heritage: IdList::EMPTY,
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
            self.report();
        }
        let (name, name_pos) = self.identifier();
        let type_params = self.type_parameters();
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
