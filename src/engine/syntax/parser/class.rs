//! Classes.

use super::context::is_eval_or_arguments;
use super::function::{Method, Site, describe};
use super::{Class, Context, Expression, Facts, Failed, Parsed, Session, Statement, nothing};
use crate::ast::{
    self, BindingFlags, BindingKind, ClassElement, ClassElementKind, ClassId, DeclarationKind,
    ExprKind, FunctionId, Initializer, PropertyKey, ScopeKind, StmtKind,
};
use crate::cache::Traits;
use crate::names::Name;
use crate::options::{FunctionFlags, FunctionKind};
use crate::scope::PrivateDeclaration;
use crate::token::TokenKind;

/// What the elements have shown so far.
struct Body {
    constructor_kind: FunctionKind,
    constructor: Option<FunctionId>,
    needs_home: bool,
    needs_static_home: bool,
    needs_initializer: bool,
    needs_brand: bool,
}

impl Body {
    fn note_home(&mut self, is_static: bool, is_used: bool) {
        if is_static {
            self.needs_static_home |= is_used;
        } else {
            self.needs_home |= is_used;
        }
    }

    fn note_private_method(&mut self, is_static: bool) {
        self.needs_static_home |= is_static;
        self.needs_brand |= !is_static;
        self.needs_initializer |= !is_static;
    }
}

/// An element up to its key.
#[derive(Clone, Copy)]
struct Head {
    start: u32,
    /// Past `static`.
    text_start: u32,
    key_start: u32,
    is_static: bool,
}

impl Session<'_> {
    pub(super) fn class_expression<const BUILD: bool>(&mut self) -> Parsed<Expression> {
        let start = self.start();
        let (class, _) = self.class::<BUILD>(false)?;
        Ok(self.node::<BUILD>(Class::Other, start, ExprKind::Class(class)))
    }

    #[inline(never)]
    pub(super) fn class_declaration<const BUILD: bool>(&mut self, site: Site) -> Parsed<Statement> {
        let start = self.start();
        let (class, own_name) = self.class::<BUILD>(site != Site::DefaultExport)?;
        let name = own_name.unwrap_or(Name::DEFAULT_EXPORT);
        let declared = self.scopes.lexical_count();
        if !self.scopes.declare_lexical(name, BindingKind::Let) {
            return Err(self.reject_naming("Cannot declare a class twice: '%'", name));
        }
        if !BUILD {
            return Ok(nothing());
        }
        if self.context.contains(Context::EXPORTING) {
            self.export_declaration(name, "Cannot export a duplicate class name: '%'")?;
        }
        (self.scopes).initialize_lexicals(declared, self.lexer.previous_end);
        let value = self.node::<BUILD>(Class::Other, start, ExprKind::Class(class));
        self.name_anonymous(value.id(), Name::DEFAULT);
        let kind = ExprKind::Initialize {
            kind: DeclarationKind::Let,
            name,
            name_start: start,
            value: value.id(),
        };
        let initialization = self.node::<BUILD>(Class::Other, start, kind);
        self.end_expression::<BUILD>(initialization);
        Ok(self.statement_node::<BUILD>(start, StmtKind::Class(initialization.id())))
    }

    #[inline(never)]
    fn class<const BUILD: bool>(&mut self, needs_name: bool) -> Parsed<(ClassId, Option<Name>)> {
        self.check_stack()?;
        let (outer, scopes) = (self.context, self.scopes.mark());
        let dropped = Context::PARAMETERS_OF_ARROW | Context::EXPORTING;
        self.set_context((outer - dropped) | Context::STRICT);
        let class = self.class_in_strict_code::<BUILD>(needs_name);
        self.set_context(outer);
        match class {
            Ok(_) => self.next(),
            Err(Failed) => self.scopes.rewind(scopes),
        }
        class
    }

    /// Up to the closing brace.
    #[inline(always)]
    fn class_in_strict_code<const BUILD: bool>(
        &mut self,
        needs_name: bool,
    ) -> Parsed<(ClassId, Option<Name>)> {
        let start = self.start();
        self.scopes.push(ScopeKind::Class, start);
        let declared = self.scopes.lexical_count();
        self.next();
        let own_name = self.class_name(needs_name)?;
        let (mut divot, mut heritage) = (start, None);
        let mut heritage_sees_private_names = false;
        if self.eat(TokenKind::Extends) {
            if self.at_await_operator() {
                return Err(self.misplaced_await());
            }
            divot = self.start();
            let earlier = self.facts & Facts::PRIVATE_NAMES;
            self.facts -= Facts::PRIVATE_NAMES;
            heritage = Some(self.member::<BUILD>()?.id());
            heritage_sees_private_names =
                self.facts.contains(Facts::PRIVATE_NAMES) || self.scopes.contains_eval();
            self.facts |= earlier;
        }
        let head_end = self.previous_end();
        self.expect(
            TokenKind::OpenBrace,
            "Expected opening '{' at the start of a class body",
        )?;
        self.scopes.push(ScopeKind::Class, head_end);
        let mut body = Body {
            constructor_kind: match heritage {
                Some(_) => FunctionKind::DerivedConstructor,
                None => FunctionKind::BaseConstructor,
            },
            constructor: None,
            needs_home: false,
            needs_static_home: false,
            needs_initializer: false,
            needs_brand: false,
        };
        let list = self.open_list();
        while !self.at(TokenKind::CloseBrace) {
            if !self.eat(TokenKind::Semicolon) {
                self.class_element::<BUILD>(&mut body)?;
            }
        }
        if !BUILD {
            self.pop_scope::<BUILD>();
            self.pop_scope::<BUILD>();
            return Ok((nothing(), own_name));
        }
        for (name, is_needed) in [
            (Name::CLASS_HOME, body.needs_home),
            (Name::CLASS_STATIC_HOME, body.needs_static_home),
            (Name::CLASS_FIELD_INITIALIZER, body.needs_initializer),
            (Name::CLASS_BRAND, body.needs_brand),
        ] {
            if is_needed {
                self.scopes.declare_class_internal(name);
            }
        }
        let end = self.token().end();
        let body_scope = self.pop_scope::<BUILD>();
        self.scopes.initialize_lexicals(declared, end);
        let head_scope = self.pop_scope::<BUILD>();
        if let Some(constructor) = body.constructor {
            self.ast[constructor].own_name = own_name;
            self.ast[constructor].name = own_name;
        }
        let elements = self.ast.close_list(list);
        let class = self.ast.push_class(ast::Class {
            own_name,
            name: own_name,
            end,
            divot,
            head_end,
            heritage,
            constructor: body.constructor,
            elements,
            head_scope,
            body_scope,
            heritage_sees_private_names,
        });
        Ok((class, own_name))
    }

    fn class_name(&mut self, is_needed: bool) -> Parsed<Option<Name>> {
        let token = self.token();
        if token.kind() == TokenKind::Await && self.context.contains(Context::STATIC_BLOCK) {
            return Err(self.reject("Cannot use 'await' as a class name within static block"));
        }
        if token.kind() == TokenKind::Identifier
            || (token.spells(TokenKind::Await) && !self.is_await_reserved())
        {
            self.next();
            if is_eval_or_arguments(token.name()) {
                return Err(self.fail_naming("'%' is not a valid class name", token.name()));
            }
            (self.scopes).declare_lexical(token.name(), BindingKind::Const);
            return Ok(Some(token.name()));
        }
        if !is_needed {
            return Ok(None);
        }
        if token.kind() == TokenKind::OpenBrace {
            return Err(self.reject("Class statements must have a name"));
        }
        self.refuse_keyword(token, "class name", "")?;
        Err(self.unexpected())
    }

    /// Whether the word before the token is all there is to the key.
    fn at_end_of_key(&self) -> bool {
        matches!(
            self.kind(),
            TokenKind::OpenParen | TokenKind::Semicolon | TokenKind::Assign | TokenKind::CloseBrace
        )
    }

    fn append_class_element<const BUILD: bool>(
        &mut self,
        head: Head,
        key: PropertyKey,
        kind: ClassElementKind,
    ) {
        if BUILD {
            let element = self.ast.push_class_element(ClassElement {
                kind,
                is_static: head.is_static,
                key,
                start: head.start,
                key_start: head.key_start,
            });
            self.ast.push_to_list(element);
        }
    }

    #[inline(never)]
    fn class_element<const BUILD: bool>(&mut self, body: &mut Body) -> Parsed<()> {
        let start = self.start();
        let mut head = Head {
            start,
            text_start: start,
            key_start: start,
            is_static: false,
        };
        if self.at(TokenKind::ReservedInStrictCode) && self.token().name() == Name::STATIC {
            self.next();
            if self.at_end_of_key() {
                let key = PropertyKey::Named(Name::STATIC);
                return self.field_or_method::<BUILD>(body, head, key, FunctionFlags::empty());
            }
            head.is_static = true;
            head.text_start = self.start();
            head.key_start = self.start();
            if self.at(TokenKind::OpenBrace) {
                let uses_home = self.static_block::<BUILD>()?;
                body.note_home(true, uses_home);
                let kind = ClassElementKind::StaticBlock;
                self.append_class_element::<BUILD>(head, PropertyKey::None, kind);
                return Ok(());
            }
        }
        let mut flags = FunctionFlags::empty();
        if self.at_contextual(Name::ASYNC) {
            self.next();
            if self.at_end_of_key() || self.at(TokenKind::Colon) || self.follows_newline() {
                let key = PropertyKey::Named(Name::ASYNC);
                return self.field_or_method::<BUILD>(body, head, key, flags);
            }
            flags = FunctionFlags::ASYNC;
        }
        if self.eat(TokenKind::Star) {
            flags |= FunctionFlags::GENERATOR;
        }
        let token = self.token();
        head.key_start = token.start();
        let key = match token.kind() {
            TokenKind::PrivateName => {
                self.next();
                self.declare_private_field_or_method(body, token.name(), head.is_static)?;
                PropertyKey::Private(token.name())
            }
            kind if kind.is_identifier_name() || kind == TokenKind::String => {
                self.next();
                PropertyKey::Named(self.word_or_string(token))
            }
            TokenKind::OpenBrace => {
                return Err(self.fail("Cannot parse static block without 'static'"));
            }
            _ => match self.numeric_or_computed_key::<BUILD>() {
                Some(key) => key?,
                None => return Err(self.unexpected()),
            },
        };
        if flags.is_empty() && self.at_accessor_key() {
            if token.is_contextual(Name::GET) {
                return self.class_accessor::<BUILD>(body, head, FunctionKind::Getter);
            }
            if token.is_contextual(Name::SET) {
                return self.class_accessor::<BUILD>(body, head, FunctionKind::Setter);
            }
        }
        self.field_or_method::<BUILD>(body, head, key, flags)
    }

    fn at_accessor_key(&self) -> bool {
        self.kind().is_identifier_name()
            || matches!(
                self.kind(),
                TokenKind::String
                    | TokenKind::Number
                    | TokenKind::BigInt
                    | TokenKind::OpenBracket
                    | TokenKind::PrivateName
            )
    }

    /// After the name.
    fn declare_private_field_or_method(
        &mut self,
        body: &mut Body,
        name: Name,
        is_static: bool,
    ) -> Parsed<()> {
        let is_method = self.at(TokenKind::OpenParen);
        let (kind, sentence) = if is_method {
            (
                BindingKind::PrivateMethod,
                "Cannot declare private method twice",
            )
        } else {
            (
                BindingKind::PrivateField,
                "Cannot declare private field twice",
            )
        };
        let result = (self.scopes).declare_private(name, kind, is_static, BindingFlags::empty());
        if result != PrivateDeclaration::Valid {
            return Err(self.reject(sentence));
        }
        if is_method {
            if name == Name::PRIVATE_CONSTRUCTOR {
                return Err(self.reject("Cannot declare a private method named '#constructor'"));
            }
            body.note_private_method(is_static);
        }
        Ok(())
    }

    fn method_flags(head: Head, flags: FunctionFlags) -> FunctionFlags {
        if head.is_static {
            flags | FunctionFlags::STATIC
        } else {
            flags
        }
    }

    /// At the key.
    fn class_accessor<const BUILD: bool>(
        &mut self,
        body: &mut Body,
        mut head: Head,
        kind: FunctionKind,
    ) -> Parsed<()> {
        head.key_start = self.start();
        if self.at(TokenKind::PrivateName) {
            self.declare_private_accessor(kind, head.is_static)?;
            body.note_private_method(head.is_static);
        }
        let key = self.accessor_key::<BUILD>(Some(head.is_static))?;
        let (function, flags) = self.accessor::<BUILD>(Method {
            kind,
            flags: Self::method_flags(head, FunctionFlags::empty()),
            start: head.text_start,
            key,
        })?;
        body.note_home(head.is_static, flags.contains(FunctionFlags::USES_HOME));
        let kind = match kind {
            FunctionKind::Getter => ClassElementKind::Getter(function),
            _ => ClassElementKind::Setter(function),
        };
        self.append_class_element::<BUILD>(head, key, kind);
        Ok(())
    }

    fn declare_private_accessor(&mut self, kind: FunctionKind, is_static: bool) -> Parsed<()> {
        let (flag, this, other) = match kind {
            FunctionKind::Getter => (BindingFlags::HAS_GETTER, "getter", "setter"),
            _ => (BindingFlags::HAS_SETTER, "setter", "getter"),
        };
        let name = self.token().name();
        match (self.scopes).declare_private(name, BindingKind::PrivateAccessor, is_static, flag) {
            PrivateDeclaration::Valid => Ok(()),
            PrivateDeclaration::Duplicate => {
                Err(self.reject("Declared private setter with an already used name"))
            }
            PrivateDeclaration::StaticMismatch => Err(self.reject_with(
                if is_static {
                    "Cannot declare a private static % if there is a non-static private % with used name"
                } else {
                    "Cannot declare a private non-static % if there is a static private % with used name"
                },
                &[this.into(), other.into()],
            )),
        }
    }

    /// After the key.
    fn field_or_method<const BUILD: bool>(
        &mut self,
        body: &mut Body,
        head: Head,
        key: PropertyKey,
        flags: FunctionFlags,
    ) -> Parsed<()> {
        if flags.is_empty() && !self.at(TokenKind::OpenParen) {
            return self.field::<BUILD>(body, head, key);
        }
        let is_constructor = !head.is_static && key == PropertyKey::Named(Name::CONSTRUCTOR);
        if is_constructor && !flags.is_empty() {
            let article = if flags.contains(FunctionFlags::ASYNC) {
                "an"
            } else {
                "a"
            };
            let kind = describe(FunctionKind::Method, flags);
            let parts = &[article.into(), kind.into()];
            return Err(self.reject_with("Cannot declare % % named 'constructor'", parts));
        }
        let (function, flags) = self.method::<BUILD>(Method {
            kind: if is_constructor {
                body.constructor_kind
            } else {
                FunctionKind::Method
            },
            flags: Self::method_flags(head, flags),
            start: head.text_start,
            key,
        })?;
        body.note_home(head.is_static, flags.contains(FunctionFlags::USES_HOME));
        if is_constructor {
            if body.constructor.replace(function).is_some() {
                return Err(self.reject("Cannot declare multiple constructors in a single class"));
            }
            return Ok(());
        }
        if head.is_static && key == PropertyKey::Named(Name::PROTOTYPE) {
            return Err(self.reject("Cannot declare a static method named 'prototype'"));
        }
        self.append_class_element::<BUILD>(head, key, ClassElementKind::Method(function));
        Ok(())
    }

    fn field<const BUILD: bool>(
        &mut self,
        body: &mut Body,
        head: Head,
        key: PropertyKey,
    ) -> Parsed<()> {
        match key {
            PropertyKey::Named(Name::CONSTRUCTOR) => {
                return Err(self.reject("Cannot declare class field named 'constructor'"));
            }
            PropertyKey::Private(Name::PRIVATE_CONSTRUCTOR) => {
                return Err(self.reject("Cannot declare private class field named '#constructor'"));
            }
            PropertyKey::Named(Name::PROTOTYPE) if head.is_static => {
                return Err(self.reject("Cannot declare a static field named 'prototype'"));
            }
            _ => {}
        }
        body.needs_initializer |= !head.is_static;
        let mut initializer = None;
        if self.eat(TokenKind::Assign) {
            let start = self.start();
            let uses_home = self.skim_initializer::<BUILD>()?;
            body.note_home(head.is_static, uses_home);
            let end = self.previous_end();
            initializer = Some(Initializer { start, end });
        }
        self.expect_semicolon("Expected a ';' following a class field")?;
        self.append_class_element::<BUILD>(head, key, ClassElementKind::Field(initializer));
        Ok(())
    }

    /// Returns whether it uses its home object.
    fn skim_initializer<const BUILD: bool>(&mut self) -> Parsed<bool> {
        let context = self.context.of_field_initializer();
        let kind = FunctionKind::FieldInitializer;
        self.implicit_function(kind, context, Traits::INITIALIZER, |it| {
            if BUILD && it.pauses.is_some() {
                it.assignment::<true>().map(drop)
            } else {
                it.assignment::<false>().map(drop)
            }
        })
    }

    /// At the brace. Returns whether it uses its home object.
    pub(super) fn static_block<const BUILD: bool>(&mut self) -> Parsed<bool> {
        let context = self.context.of_static_block();
        self.implicit_function(FunctionKind::StaticBlock, context, Traits::empty(), |it| {
            if BUILD && it.pauses.is_some() {
                it.block_contents::<true>().map(drop)
            } else {
                it.block_contents::<false>().map(drop)
            }
        })
    }
}
