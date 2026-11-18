//! Literals.

use bun_engine_regexp::check_syntax;

use super::function::Method;
use super::pattern::ABBREVIATED_KEYWORD;
use super::{Class, Expression, Facts, Failed, Parsed, Pass, Session, nothing};
use crate::ast::{
    Element, ExprId, ExprKind, Property, PropertyKey, PropertyKind, ResultType, Template,
    TemplateId,
};
use crate::lexer::TEMPLATE_IS_TAIL;
use crate::names::Name;
use crate::options::{FunctionFlags, FunctionKind};
use crate::scope::Scopes;
use crate::token::{Token, TokenKind};

/// What the properties of an object literal have shown so far.
#[derive(Default)]
struct ObjectState {
    sets_prototype: bool,
    uses_home: bool,
}

impl Session<'_> {
    /// A number or a string.
    #[inline(always)]
    pub(super) fn scalar<const BUILD: bool>(&mut self) -> Expression {
        let token = self.token();
        let class = match token.kind() {
            TokenKind::String => Class::String,
            _ => Class::Other,
        };
        let word = if BUILD {
            self.scalar_node(token).word()
        } else {
            0
        };
        self.next();
        Expression { word, class }
    }

    fn scalar_node(&mut self, token: Token) -> ExprId {
        if token.kind() == TokenKind::Number {
            let (value, is_integer) = self.lexer.number_value(token);
            return self.number_node(token.start(), value, is_integer);
        }
        let value = self.lexer.string_value(token);
        self.push_typed(token.start(), ResultType::STRING, ExprKind::String(value))
    }

    pub(super) fn bigint_literal<const BUILD: bool>(&mut self) -> Expression {
        let token = self.token();
        self.next();
        let (digits, radix) = if BUILD {
            self.lexer.bigint_value(token)
        } else {
            (Name::EMPTY, 10)
        };
        let kind = ExprKind::BigInt {
            digits,
            radix,
            is_negative: false,
        };
        self.typed_node::<BUILD>(Class::Other, token.start(), ResultType::BIGINT, kind)
    }

    pub(super) fn regexp_literal<const BUILD: bool>(&mut self) -> Parsed<Expression> {
        let token = self.check_regexp()?;
        let (mut pattern, mut flags) = (Name::EMPTY, Name::EMPTY);
        if BUILD {
            let (source, names) = (self.lexer.source, &mut self.lexer.names);
            let flags_start = token.value() as usize;
            pattern = names.literal_in_source(source, token.start() as usize + 1, flags_start - 1);
            flags = names.intern_source(source, flags_start, token.end() as usize);
        }
        let kind = ExprKind::RegExp { pattern, flags };
        Ok(self.node::<BUILD>(Class::Other, token.start(), kind))
    }

    fn check_regexp(&mut self) -> Parsed<Token> {
        self.lexer.scan_regexp();
        self.require(TokenKind::RegExp, "Invalid regular expression")?;
        let token = self.token();
        self.next();
        if !self.context.contains(super::Context::CHECKED_BEFORE) {
            let source = self.lexer.source;
            let pattern = source.slice(token.start() + 1, token.value() - 1);
            if let Err(error) = check_syntax(pattern, source.slice(token.value(), token.end())) {
                return Err(self.reject_verbatim(error.message(), &[]));
            }
        }
        Ok(token)
    }

    pub(super) fn template_literal<const BUILD: bool>(&mut self) -> Parsed<Expression> {
        let start = self.start();
        let template = self.template::<BUILD>(false)?;
        Ok(self.node::<BUILD>(Class::Other, start, ExprKind::Template(template)))
    }

    #[inline(never)]
    pub(super) fn tagged_template<const BUILD: bool>(
        &mut self,
        start: u32,
        tag: Expression,
    ) -> Parsed<Expression> {
        let divot = self.start();
        let template = self.template::<BUILD>(true)?;
        self.note_more_than_read(tag);
        self.facts |= Facts::TAGGED_TEMPLATE;
        let kind = ExprKind::TaggedTemplate {
            tag: tag.id(),
            template,
            divot,
            end: self.previous_end(),
        };
        let node = self.node::<BUILD>(Class::Other, start, kind);
        self.end_expression::<BUILD>(node);
        Ok(node)
    }

    /// The parts go in one list at first: cooked, raw, expression, and so on.
    fn template<const BUILD: bool>(&mut self, is_tagged: bool) -> Parsed<TemplateId> {
        let parts = self.open_list();
        loop {
            self.lexer.scan_template(is_tagged);
            self.require(TokenKind::Template, "Expected an template element")?;
            let token = self.token();
            if BUILD {
                let cooked = self.lexer.cooked_template(token);
                let raw = is_tagged.then(|| self.lexer.raw_template(token));
                self.ast.push_to_list(cooked);
                self.ast.push_to_list(raw);
            }
            self.next();
            if token.value() & TEMPLATE_IS_TAIL != 0 {
                break;
            }
            if self.at(TokenKind::CloseBrace) {
                return Err(self.fail("Template literal expression cannot be empty"));
            }
            let expression = self.expression::<BUILD>()?;
            self.append::<BUILD>(expression.id());
            self.require(
                TokenKind::CloseBrace,
                "Expected a closing '}' following an expression in template literal",
            )?;
        }
        if !BUILD {
            return Ok(nothing());
        }
        let template = Template {
            cooked: self.ast.every_third(parts, 0),
            raw: if is_tagged {
                self.ast.every_third(parts, 1)
            } else {
                crate::ast::List::EMPTY
            },
            expressions: self.ast.every_third(parts, 2),
        };
        self.ast.abandon_list(parts);
        Ok(self.ast.push_template(template))
    }

    #[inline(never)]
    pub(super) fn array_literal<const BUILD: bool>(&mut self) -> Parsed<Expression> {
        let (start, list) = (self.start(), self.open_list());
        self.next();
        loop {
            let element = match self.kind() {
                TokenKind::CloseBracket => break,
                TokenKind::Comma => {
                    self.append::<BUILD>(None::<ExprId>);
                    self.next();
                    continue;
                }
                TokenKind::Ellipsis => self.spread::<BUILD>()?,
                TokenKind::Number | TokenKind::String
                    if matches!(self.lexer.byte(self.token().end() as usize), b',' | b']') =>
                {
                    self.scalar::<BUILD>()
                }
                _ => self.assignment::<BUILD>()?,
            };
            self.append::<BUILD>(element.id());
            if !self.eat(TokenKind::Comma) {
                if !self.at(TokenKind::CloseBracket) {
                    return Err(self.fail_in_array());
                }
                break;
            }
        }
        self.next();
        let elements = self.close_list::<BUILD, _>(list);
        Ok(self.node::<BUILD>(Class::Literal, start, ExprKind::Array(elements)))
    }

    #[cold]
    #[inline(never)]
    fn fail_in_array(&mut self) -> Failed {
        if self.at(TokenKind::Ellipsis) {
            return self.reject("The '...' operator should come before a target expression");
        }
        self.fail("Expected either a closing ']' or a ',' following an array element")
    }

    #[inline(never)]
    pub(super) fn object_literal<const BUILD: bool>(&mut self) -> Parsed<Expression> {
        let (start, list) = (self.start(), self.open_list());
        let mut state = ObjectState::default();
        loop {
            self.lexer.next_key::<BUILD>();
            if self.at(TokenKind::CloseBrace) {
                break;
            }
            self.property::<BUILD>(&mut state)?;
            if !self.at(TokenKind::Comma) {
                self.require(
                    TokenKind::CloseBrace,
                    "Expected '}' to end an object literal",
                )?;
                break;
            }
        }
        self.next();
        let properties = self.close_list::<BUILD, _>(list);
        let home = (BUILD && state.uses_home).then(|| Scopes::record_home_scope(start, self.ast));
        let kind = ExprKind::Object { properties, home };
        Ok(self.node::<BUILD>(Class::Literal, start, kind))
    }

    #[inline(always)]
    fn append_property<const BUILD: bool>(
        &mut self,
        kind: PropertyKind,
        key: PropertyKey,
        value: ExprId,
    ) {
        if BUILD {
            let property = self.ast.push_property(Property { kind, key, value });
            self.append::<BUILD>(property);
        }
    }

    #[inline(always)]
    fn property<const BUILD: bool>(&mut self, state: &mut ObjectState) -> Parsed<()> {
        let token = self.token();
        if !token.kind().is_identifier_name() && token.kind() != TokenKind::String {
            return self.elaborate_property::<BUILD>(state, token.start(), FunctionFlags::empty());
        }
        self.lexer.next_ignoring_keywords::<BUILD>();
        if !self.at(TokenKind::Colon) {
            return self.property_without_colon::<BUILD>(state, token);
        }
        self.next();
        let value = self.property_value::<BUILD>()?;
        let may_set_prototype =
            token.is_elaborate() || matches!(token.end() - token.start(), 9 | 11);
        if !BUILD && !may_set_prototype {
            return Ok(());
        }
        let name = self.word_or_string(token);
        if name == Name::PROTO {
            if core::mem::replace(&mut state.sets_prototype, true) && self.pass != Pass::Scouting {
                return Err(self.reject("Attempted to redefine __proto__ property"));
            }
            self.append_property::<BUILD>(PropertyKind::Prototype, PropertyKey::Named(name), value);
        } else if BUILD {
            self.name_anonymous(value, name);
            self.append_property::<BUILD>(PropertyKind::Value, PropertyKey::Named(name), value);
        }
        Ok(())
    }

    #[inline(always)]
    fn property_value<const BUILD: bool>(&mut self) -> Parsed<ExprId> {
        let value = self.assignment::<BUILD>()?.id();
        if BUILD {
            self.ast[value].end = self.token().end();
        }
        Ok(value)
    }

    pub(super) fn word_or_string(&mut self, token: Token) -> Name {
        match token.kind() {
            TokenKind::String => self.lexer.string_name(token),
            _ => self.lexer.looked_up(token).name(),
        }
    }

    /// After `token`, which is a word or a string.
    #[inline(never)]
    fn property_without_colon<const BUILD: bool>(
        &mut self,
        state: &mut ObjectState,
        token: Token,
    ) -> Parsed<()> {
        if self.at(TokenKind::OpenParen) {
            let key = if BUILD {
                PropertyKey::Named(self.word_or_string(token))
            } else {
                PropertyKey::None
            };
            return self.method_property::<BUILD>(
                state,
                key,
                token.start(),
                FunctionFlags::empty(),
            );
        }
        if token.kind() == TokenKind::String {
            return Err(self.fail("Expected an identifier as property name"));
        }
        let token = self.lexer.looked_up(token);
        if matches!(self.kind(), TokenKind::Comma | TokenKind::CloseBrace) {
            return self.shorthand_property::<BUILD>(token);
        }
        if self.pass == Pass::Scouting && self.eat(TokenKind::Assign) {
            return self.assignment::<false>().map(drop);
        }
        let kind = match token.name() {
            Name::GET if !token.is_elaborate() => FunctionKind::Getter,
            Name::SET if !token.is_elaborate() => FunctionKind::Setter,
            Name::ASYNC if !token.is_elaborate() => {
                self.lexer.read_again();
                if self.follows_newline() {
                    return Err(self.fail("Expected a property name following keyword 'async'"));
                }
                return self.elaborate_property::<BUILD>(
                    state,
                    token.start(),
                    FunctionFlags::ASYNC,
                );
            }
            name => {
                let sentence = "Expected a ':' following the property name '%'";
                self.blame_comment_after(token, sentence);
                return Err(self.fail_naming(sentence, name));
            }
        };
        let key_start = self.start();
        let key = self.accessor_key::<BUILD>(None)?;
        let method = Method {
            kind,
            flags: FunctionFlags::empty(),
            start: token.start(),
            key,
        };
        let (function, flags) = self.accessor::<BUILD>(method)?;
        state.uses_home |= flags.contains(FunctionFlags::USES_HOME);
        let value = self.node::<BUILD>(Class::Other, key_start, ExprKind::Function(function));
        let kind = match kind {
            FunctionKind::Getter => PropertyKind::Getter,
            _ => PropertyKind::Setter,
        };
        self.append_property::<BUILD>(kind, key, value.id());
        Ok(())
    }

    fn shorthand_property<const BUILD: bool>(&mut self, token: Token) -> Parsed<()> {
        if token.kind() != TokenKind::Identifier || token.name() == Name::ARGUMENTS {
            self.check_unusual_shorthand(token)?;
        }
        let value = self.reference::<BUILD>(Class::Identifier, token);
        let key = PropertyKey::Named(token.name());
        self.append_property::<BUILD>(PropertyKind::Value, key, value.id());
        Ok(())
    }

    #[cold]
    fn check_unusual_shorthand(&mut self, token: Token) -> Parsed<()> {
        if token.kind() == TokenKind::Identifier {
            self.facts |= Facts::USES_ARGUMENTS;
            return self.refuse_arguments();
        }
        if token.kind() == TokenKind::EscapedKeyword && !self.is_unreserved(token) {
            return Err(self.reject_naming(ABBREVIATED_KEYWORD, token.name()));
        }
        self.refuse_keyword(token, "shorthand property name", "")
    }

    /// After `async` if `flags` say so.
    #[inline(never)]
    fn elaborate_property<const BUILD: bool>(
        &mut self,
        state: &mut ObjectState,
        start: u32,
        mut flags: FunctionFlags,
    ) -> Parsed<()> {
        if self.eat(TokenKind::Star) {
            flags |= FunctionFlags::GENERATOR;
        }
        let token = self.token();
        let key = match token.kind() {
            TokenKind::Ellipsis if flags.is_empty() => {
                let spread = self.spread::<BUILD>()?;
                self.append_property::<BUILD>(PropertyKind::Spread, PropertyKey::None, spread.id());
                return Ok(());
            }
            kind if kind.is_identifier_name() || kind == TokenKind::String => {
                self.lexer.next_ignoring_keywords::<true>();
                PropertyKey::Named(self.word_or_string(token))
            }
            _ => match self.numeric_or_computed_key::<BUILD>() {
                Some(key) => key?,
                None => return Err(self.fail("Expected a property name")),
            },
        };
        if self.at(TokenKind::OpenParen) {
            return self.method_property::<BUILD>(state, key, start, flags);
        }
        if !flags.is_empty() {
            return Err(self.fail("Expected a parenthesis for argument list"));
        }
        self.expect(TokenKind::Colon, "Expected ':' after property name")?;
        let value = self.property_value::<BUILD>()?;
        if BUILD && let PropertyKey::Named(name) = key {
            self.name_anonymous(value, name);
        }
        self.append_property::<BUILD>(PropertyKind::Value, key, value);
        Ok(())
    }

    fn method_property<const BUILD: bool>(
        &mut self,
        state: &mut ObjectState,
        key: PropertyKey,
        start: u32,
        flags: FunctionFlags,
    ) -> Parsed<()> {
        let parameters_start = self.start();
        let (function, flags) = self.method::<BUILD>(Method {
            kind: FunctionKind::Method,
            flags,
            start,
            key,
        })?;
        state.uses_home |= flags.contains(FunctionFlags::USES_HOME);
        let kind = ExprKind::Function(function);
        let value = self.node::<BUILD>(Class::Other, parameters_start, kind);
        self.append_property::<BUILD>(PropertyKind::Value, key, value.id());
        Ok(())
    }

    /// The name that a number or a BigInt stands for.
    pub(super) fn numeric_key<const BUILD: bool>(&mut self) -> Parsed<Name> {
        let token = self.token();
        match token.kind() {
            _ if !BUILD => Ok(Name::EMPTY),
            TokenKind::Number => Ok(self.lexer.number_key(token)),
            _ => match self.lexer.bigint_key(token) {
                Some(name) => Ok(name),
                None => Err(self.fail("Cannot parse big int property name")),
            },
        }
    }

    /// None if the token starts neither.
    pub(super) fn numeric_or_computed_key<const BUILD: bool>(
        &mut self,
    ) -> Option<Parsed<PropertyKey>> {
        match self.kind() {
            TokenKind::Number | TokenKind::BigInt => {
                Some(self.numeric_key::<BUILD>().map(|name| {
                    self.next();
                    PropertyKey::Named(name)
                }))
            }
            TokenKind::OpenBracket => Some(self.computed_key::<BUILD>()),
            _ => None,
        }
    }

    fn computed_key<const BUILD: bool>(&mut self) -> Parsed<PropertyKey> {
        self.next();
        let key = self.assignment::<BUILD>()?;
        self.expect(
            TokenKind::CloseBracket,
            "Expected ']' to end a computed property name",
        )?;
        Ok(PropertyKey::Computed(key.id()))
    }

    /// `is_static` is none outside of a class.
    pub(super) fn accessor_key<const BUILD: bool>(
        &mut self,
        is_static: Option<bool>,
    ) -> Parsed<PropertyKey> {
        let token = self.token();
        if token.kind() == TokenKind::PrivateName {
            if token.name() == Name::PRIVATE_CONSTRUCTOR {
                return Err(self.reject("Cannot declare a private accessor named '#constructor'"));
            }
            if is_static.is_none() {
                return Err(
                    self.reject("Cannot declare a private setter or getter outside a class")
                );
            }
            self.next();
            return Ok(PropertyKey::Private(token.name()));
        }
        if !token.kind().is_identifier_name() && token.kind() != TokenKind::String {
            return (self.numeric_or_computed_key::<BUILD>())
                .unwrap_or_else(|| Err(self.unexpected()));
        }
        let name = self.word_or_string(token);
        match (is_static, name) {
            (Some(true), Name::PROTOTYPE) => {
                Err(self.reject("Cannot declare a static method named 'prototype'"))
            }
            (Some(false), Name::CONSTRUCTOR) => {
                Err(self.reject("Cannot declare a getter or setter named 'constructor'"))
            }
            _ => {
                self.next();
                Ok(PropertyKey::Named(name))
            }
        }
    }
}
