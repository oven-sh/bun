//! Patterns, and the names that they bind or assign to.

use super::context::{is_eval_or_arguments, is_reserved_in_strict_code};
use super::cover::Role;
use super::{Context, Facts, Failed, Parsed, Pass, Pattern, Session};
use crate::ast::{BindingKind, DeclarationKind, ExprId, PatternElement, PatternKind, PropertyKey};
use crate::names::Name;
use crate::token::{Token, TokenKind};

/// What becomes of the names in a pattern.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Binder {
    Var,
    Let,
    Const,
    Catch,
    Parameter,
    Assignment,
}

impl Binder {
    fn role(self) -> &'static str {
        match self {
            Binder::Var => "variable name",
            Binder::Let | Binder::Const => "lexical variable name",
            Binder::Catch => "catch parameter name",
            Binder::Parameter => "parameter name",
            Binder::Assignment => "expression name",
        }
    }

    fn is_lexical(self) -> bool {
        matches!(self, Binder::Let | Binder::Const)
    }

    fn declaration(self) -> Option<DeclarationKind> {
        match self {
            Binder::Var => Some(DeclarationKind::Var),
            Binder::Let | Binder::Catch | Binder::Parameter => Some(DeclarationKind::Let),
            Binder::Const => Some(DeclarationKind::Const),
            Binder::Assignment => None,
        }
    }
}

pub(super) const LET_IN_LEXICAL_DECLARATION: &str =
    "Cannot use 'let' as an identifier name for a LexicalDeclaration";

pub(super) const ABBREVIATED_KEYWORD: &str =
    "Cannot use abbreviated destructuring syntax for keyword '%'";

impl Session<'_> {
    /// For an assignment it may fail without a complaint.
    #[inline(never)]
    pub(super) fn pattern<const BUILD: bool>(&mut self, binder: Binder) -> Parsed<Pattern> {
        self.check_stack()?;
        self.count_assignment::<BUILD>();
        match self.kind() {
            TokenKind::OpenBracket => self.array_pattern::<BUILD>(binder),
            TokenKind::OpenBrace => self.object_pattern::<BUILD>(binder),
            _ if self.at_name() => self.binding_name::<BUILD>(binder),
            _ => Err(self.fail_for_pattern(binder)),
        }
    }

    #[cold]
    #[inline(never)]
    fn fail_for_pattern(&mut self, binder: Binder) -> Failed {
        if let Err(failed) = self.refuse_keyword(self.token(), binder.role(), "") {
            return failed;
        }
        if binder != Binder::Parameter && self.at(TokenKind::PrivateName) {
            return self.fail_saying("Cannot use a private name as a %", binder.role());
        }
        self.fail("Expected a parameter pattern or a ')' in parameter list")
    }

    #[inline(always)]
    pub(super) fn binding_name<const BUILD: bool>(&mut self, binder: Binder) -> Parsed<Pattern> {
        let token = self.token();
        if token.kind() != TokenKind::Identifier {
            if binder.is_lexical() && token.spells(TokenKind::Let) {
                return Err(self.fail(LET_IN_LEXICAL_DECLARATION));
            }
            self.refuse_await(token, binder.role())?;
        }
        let binding = self.bind::<BUILD>(binder, token);
        self.next();
        binding
    }

    #[inline(always)]
    fn bind<const BUILD: bool>(&mut self, binder: Binder, token: Token) -> Parsed<Pattern> {
        let name = token.name();
        self.declare_bound_name(binder, name, token.start())?;
        if BUILD && binder != Binder::Assignment && self.context.contains(Context::EXPORTING) {
            self.export_declaration(name, "Cannot export a duplicate name '%'")?;
        }
        let declaration = binder.declaration();
        let kind = PatternKind::Binding { name, declaration };
        Ok(self.pattern_node::<BUILD>(token.start(), token.end(), kind))
    }

    fn declare_bound_name(&mut self, binder: Binder, name: Name, start: u32) -> Parsed<()> {
        let kind = match binder {
            Binder::Parameter => return self.declare_parameter(name),
            Binder::Assignment => {
                self.scopes.write(name, start);
                return Ok(());
            }
            Binder::Var => {
                if is_eval_or_arguments(name) {
                    let sentence = "Cannot declare a variable named '%' in strict mode";
                    self.declare_eval_or_arguments(name, sentence)?;
                }
                self.declare_variable(name, start)?;
                self.scopes.write(name, start);
                return Ok(());
            }
            Binder::Let | Binder::Catch => BindingKind::Let,
            Binder::Const => BindingKind::Const,
        };
        if is_eval_or_arguments(name) {
            let sentence = "Cannot destructure to a variable named '%' in strict mode";
            self.declare_eval_or_arguments(name, sentence)?;
        }
        if !self.scopes.declare_lexical(name, kind) {
            return Err(self.fail_naming("Cannot declare a lexical variable twice: '%'", name));
        }
        Ok(())
    }

    #[cold]
    #[inline(never)]
    pub(super) fn declare_eval_or_arguments(
        &mut self,
        name: Name,
        sentence: &'static str,
    ) -> Parsed<()> {
        if self.is_strict() {
            return Err(self.reject_naming(sentence, name));
        }
        if name == Name::ARGUMENTS {
            self.facts |= Facts::USES_ARGUMENTS;
        }
        Ok(())
    }

    #[inline(always)]
    pub(super) fn declare_variable(&mut self, name: Name, start: u32) -> Parsed<()> {
        if !self.scopes.declare_variable(name, start) {
            return Err(self.reject_naming(
                "Cannot declare a var variable that shadows a let/const/class variable: '%'",
                name,
            ));
        }
        Ok(())
    }

    #[inline(always)]
    pub(super) fn declare_parameter(&mut self, name: Name) -> Parsed<()> {
        let is_first = self.scopes.declare_parameter(name);
        if is_first && name > Name::EVAL {
            return Ok(());
        }
        self.check_unusual_parameter(name, is_first)
    }

    #[cold]
    #[inline(never)]
    fn check_unusual_parameter(&mut self, name: Name, is_first: bool) -> Parsed<()> {
        if is_eval_or_arguments(name) {
            let sentence = "Cannot destructure to a parameter name '%' in strict mode";
            self.declare_eval_or_arguments(name, sentence)?;
        } else if is_first && !is_reserved_in_strict_code(name) {
            return Ok(());
        }
        self.facts |= Facts::PARAMETERS_INVALID_IF_STRICT;
        if self.is_strict() {
            self.refuse_keyword(self.token(), "parameter name", "")?;
            return Err(self.reject_naming(
                "Cannot declare a parameter named '%' in strict mode as it has already been declared",
                name,
            ));
        }
        if !is_first {
            self.duplicate_parameter = Some(name);
        }
        Ok(())
    }

    #[inline(always)]
    fn element<const BUILD: bool>(&mut self, binder: Binder) -> Parsed<Pattern> {
        match binder {
            Binder::Assignment => self.assignment_element::<BUILD>(),
            _ => self.pattern::<BUILD>(binder),
        }
    }

    fn assignment_element<const BUILD: bool>(&mut self) -> Parsed<Pattern> {
        let start = self.start();
        let is_literal = matches!(self.kind(), TokenKind::OpenBrace | TokenKind::OpenBracket);
        if is_literal && self.stacks.memo.recall(start) != Some(Role::Expression) {
            if self.pass != Pass::First {
                return self.pattern::<BUILD>(Binder::Assignment);
            }
            let (mark, tentative) = (self.mark(), self.scopes.begin_tentative());
            match self.pattern::<BUILD>(Binder::Assignment) {
                Ok(pattern)
                    if !self.kind().continues_member() || self.at(TokenKind::QuestionDot) =>
                {
                    self.scopes.commit_tentative(tentative);
                    return Ok(pattern);
                }
                _ if !self.may_try_again() => return Err(Failed),
                _ => {
                    self.stacks.memo.remember(start, Role::Expression);
                    self.rewind(&mark);
                }
            }
        }
        self.assignment_target::<BUILD>(false)
    }

    fn assignment_target<const BUILD: bool>(&mut self, is_object_rest: bool) -> Parsed<Pattern> {
        let start = self.start();
        let target = self.member::<BUILD>()?;
        if !target.class.is_reference() {
            return Err(self.reject("Invalid destructuring assignment target"));
        }
        if target.class.is_eval_or_arguments() && self.is_strict() {
            if is_object_rest {
                let name = self.name_of::<BUILD>(target);
                return Err(self.fail_naming("Cannot modify '%' in strict mode", name));
            }
            return Err(self.reject_modification::<BUILD>(target));
        }
        self.note_write::<BUILD>(start, target);
        let kind = PatternKind::Target(target.id());
        Ok(self.pattern_node::<BUILD>(start, self.previous_end(), kind))
    }

    /// `= value`, if it is there.
    #[inline(always)]
    pub(super) fn default_value<const BUILD: bool>(
        &mut self,
        binder: Binder,
        pattern: Pattern,
    ) -> Parsed<Option<ExprId>> {
        if !self.at(TokenKind::Assign) {
            return Ok(None);
        }
        self.present_default_value::<BUILD>(binder, pattern)
            .map(Some)
    }

    #[inline(never)]
    fn present_default_value<const BUILD: bool>(
        &mut self,
        binder: Binder,
        pattern: Pattern,
    ) -> Parsed<ExprId> {
        self.next();
        let value = self.expression_in_pattern::<BUILD>(binder)?;
        if BUILD {
            self.ast[value].end = self.previous_end();
            self.name_after_pattern(value, pattern);
        }
        Ok(value)
    }

    fn expression_in_pattern<const BUILD: bool>(&mut self, binder: Binder) -> Parsed<ExprId> {
        if binder == Binder::Parameter {
            self.facts |= Facts::PARAMETER_EXPRESSIONS;
        }
        Ok(self.assignment::<BUILD>()?.id())
    }

    #[inline(always)]
    pub(super) fn append_element<const BUILD: bool>(&mut self, element: PatternElement) {
        if BUILD {
            let element = self.ast.push_pattern_element(element);
            self.ast.push_to_list(element);
        }
    }

    fn note_pattern(&mut self, binder: Binder) {
        if binder == Binder::Parameter {
            self.facts |= Facts::PARAMETER_PATTERNS;
        }
    }

    fn array_pattern<const BUILD: bool>(&mut self, binder: Binder) -> Parsed<Pattern> {
        let (start, list) = (self.start(), self.open_list());
        self.note_pattern(binder);
        self.next();
        let mut is_rest = false;
        while !self.at(TokenKind::CloseBracket) {
            let mut element = PatternElement {
                key: PropertyKey::None,
                pattern: None,
                default: None,
                is_rest: false,
            };
            if !self.at(TokenKind::Comma) {
                is_rest = self.eat(TokenKind::Ellipsis);
                let pattern = self.element::<BUILD>(binder)?;
                element.pattern = Some(pattern);
                element.is_rest = is_rest;
                if !is_rest {
                    element.default = self.default_value::<BUILD>(binder, pattern)?;
                }
            }
            self.append_element::<BUILD>(element);
            if is_rest || !self.eat(TokenKind::Comma) {
                break;
            }
        }
        self.expect(
            TokenKind::CloseBracket,
            if is_rest {
                "Expected a closing ']' following a rest element destructuring pattern"
            } else {
                "Expected either a closing ']' or a ',' following an element destructuring pattern"
            },
        )?;
        let kind = PatternKind::Array(self.close_list::<BUILD, _>(list));
        Ok(self.pattern_node::<BUILD>(start, self.previous_end(), kind))
    }

    fn object_pattern<const BUILD: bool>(&mut self, binder: Binder) -> Parsed<Pattern> {
        let (start, list) = (self.start(), self.open_list());
        self.note_pattern(binder);
        self.next();
        let mut is_rest = false;
        while !self.at(TokenKind::CloseBrace) {
            is_rest = self.eat(TokenKind::Ellipsis);
            let element = if is_rest {
                PatternElement {
                    key: PropertyKey::None,
                    pattern: Some(self.object_rest::<BUILD>(binder)?),
                    default: None,
                    is_rest,
                }
            } else {
                let (key, pattern) = self.pattern_property::<BUILD>(binder)?;
                PatternElement {
                    key,
                    pattern: Some(pattern),
                    default: self.default_value::<BUILD>(binder, pattern)?,
                    is_rest,
                }
            };
            self.append_element::<BUILD>(element);
            if is_rest || !self.eat(TokenKind::Comma) {
                break;
            }
        }
        if binder == Binder::Assignment && !self.at(TokenKind::CloseBrace) {
            return Err(Failed);
        }
        self.expect(
            TokenKind::CloseBrace,
            if is_rest {
                "Expected a closing '}' following a rest element destructuring pattern"
            } else {
                "Expected either a closing '}' or an ',' after a property destructuring pattern"
            },
        )?;
        let kind = PatternKind::Object(self.close_list::<BUILD, _>(list));
        Ok(self.pattern_node::<BUILD>(start, self.previous_end(), kind))
    }

    fn object_rest<const BUILD: bool>(&mut self, binder: Binder) -> Parsed<Pattern> {
        if binder == Binder::Assignment {
            return self.assignment_target::<BUILD>(true);
        }
        if !self.at_name() {
            self.refuse_keyword(self.token(), binder.role(), "")?;
            return Err(self.fail("Expected a binding element"));
        }
        self.binding_name::<BUILD>(binder)
    }

    fn pattern_property<const BUILD: bool>(
        &mut self,
        binder: Binder,
    ) -> Parsed<(PropertyKey, Pattern)> {
        let token = self.token();
        if token.kind() == TokenKind::EscapedKeyword || self.is_name(token) {
            self.next();
            let pattern = if self.eat(TokenKind::Colon) {
                self.element::<BUILD>(binder)?
            } else {
                self.shorthand_binding::<BUILD>(binder, token)?
            };
            return Ok((PropertyKey::Named(token.name()), pattern));
        }
        let key = match token.kind() {
            TokenKind::Number | TokenKind::BigInt => {
                PropertyKey::Named(self.numeric_key::<BUILD>()?)
            }
            TokenKind::String if BUILD => PropertyKey::Named(self.lexer.string_name(token)),
            TokenKind::String => PropertyKey::None,
            TokenKind::OpenBracket => {
                self.next();
                let key = self.expression_in_pattern::<BUILD>(binder)?;
                self.require(
                    TokenKind::CloseBracket,
                    "Expected ']' to end end a computed property name",
                )?;
                PropertyKey::Computed(key)
            }
            kind if kind.is_keyword() => PropertyKey::Named(token.name()),
            _ if binder == Binder::Assignment => return Err(Failed),
            _ => return Err(self.fail("Expected a property name")),
        };
        self.next();
        if !self.eat(TokenKind::Colon) {
            return Err(self.fail_for_colon(binder, token));
        }
        Ok((key, self.element::<BUILD>(binder)?))
    }

    #[cold]
    fn fail_for_colon(&mut self, binder: Binder, key: Token) -> Failed {
        let sentence = match key.kind() {
            _ if binder == Binder::Assignment => return Failed,
            TokenKind::Enum => "Cannot use abbreviated destructuring syntax for reserved name '%'",
            TokenKind::ReservedInStrictCode => {
                "Cannot use abbreviated destructuring syntax for reserved name '%' in strict mode"
            }
            kind if kind.is_keyword() => ABBREVIATED_KEYWORD,
            _ => return self.fail("Expected a ':' prior to a named destructuring property"),
        };
        self.reject_naming(sentence, key.name())
    }

    /// After the name.
    fn shorthand_binding<const BUILD: bool>(
        &mut self,
        binder: Binder,
        token: Token,
    ) -> Parsed<Pattern> {
        let name = token.name();
        if token.kind() != TokenKind::Identifier {
            if binder.is_lexical() && token.kind() == TokenKind::Let {
                return Err(self.reject("Cannot use the keyword 'let' as a lexical variable name"));
            }
            if token.kind() == TokenKind::EscapedKeyword
                && (!self.is_unreserved(token) || (binder.is_lexical() && name == Name::LET))
            {
                return Err(self.reject_naming(ABBREVIATED_KEYWORD, name));
            }
            self.refuse_await(token, binder.role())?;
        } else if binder == Binder::Assignment && is_eval_or_arguments(name) {
            self.declare_eval_or_arguments(name, "Cannot modify '%' in strict mode")?;
            if name == Name::ARGUMENTS && self.context.contains(Context::NO_ARGUMENTS_IN_EVAL) {
                self.refuse_arguments()?;
            }
        }
        self.bind::<BUILD>(binder, token)
    }
}
