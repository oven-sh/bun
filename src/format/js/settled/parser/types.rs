use super::expression::Owner;
use super::*;

fn is_type_keyword(token: T) -> bool {
    matches!(
        token,
        T::Any
            | T::Bigint
            | T::Boolean
            | T::Never
            | T::Null
            | T::Number
            | T::Object
            | T::String
            | T::Symbol
            | T::This
            | T::Undefined
            | T::UnknownWord
            | T::Void
    )
}

impl Parser<'_> {
    /// The name of a class, interface, alias, enum, namespace or type parameter.
    pub(super) fn type_name(&mut self) -> P {
        require(self.token() == T::Ident)?;
        Some(self.leaf(K::Ident))
    }

    #[inline]
    pub(super) fn optional_type_annotation(&mut self) -> P {
        match self.eat_separator(T::Colon) {
            true => {
                self.require_typescript()?;
                self.ty()
            }
            false => Some(NONE),
        }
    }

    pub(super) fn type_in_expression(&mut self) -> P {
        let ty = self.ty()?;
        // `a as B?`, `a as B!`
        require(self.token() != T::Bang)?;
        if self.token() == T::Question {
            let (next, _) = self.peek();
            let starts_type = next.is_identifier()
                || matches!(
                    next,
                    T::Str | T::Num | T::Null | T::OpenBrace | T::OpenBracket
                );
            require(starts_type)?;
        }
        Some(ty)
    }

    pub(super) fn ty(&mut self) -> P {
        let token = self.token();
        if token.is_word() {
            let (next, _) = self.peek();
            if next.ends_expression() || matches!(next, T::Gt | T::Eq | T::OpenBrace) {
                if token == T::Ident {
                    let name = self.leaf(K::Ident);
                    return Some(self.add1(K::TypeRef, self.node(name).start, name));
                }
                if is_type_keyword(token) {
                    return Some(self.leaf(K::TypeKeyword));
                }
            }
        }
        self.enter()?;
        let ty = self.type_inner()?;
        self.leave();
        Some(ty)
    }

    fn type_inner(&mut self) -> P {
        let start = self.start();
        match self.token() {
            T::Lt => return self.function_type(start, T::Unknown, 0),
            T::New => {
                self.next();
                return self.function_type(start, T::New, 0);
            }
            T::Abstract => {
                self.next_is(T::New)?;
                self.next();
                return self.function_type(start, T::New, flag::ABSTRACT);
            }
            T::OpenParen => {
                require(self.budget > 0)?;
                let snapshot = self.snapshot();
                match self.parameters(Gap::Open, Owner::Signature) {
                    Some(params) if self.token() == T::Arrow => {
                        return self.function_type_rest(start, T::Unknown, 0, NONE, params);
                    }
                    _ => self.rewind(&snapshot),
                }
            }
            _ => {}
        }
        let check = self.union()?;
        if self.token() != T::Extends || self.has(ctx::NO_CONDITIONAL_TYPE) {
            return Some(check);
        }
        require(!self.newline_before())?;
        self.next();
        let extends = self.with(self.ctx | ctx::NO_CONDITIONAL_TYPE | ctx::INFER, Self::ty)?;
        self.expect(T::Question)?;
        let yes = self.ty()?;
        self.expect(T::Colon)?;
        let no = self.ty()?;
        Some(self.add(
            K::Conditional,
            T::Unknown,
            0,
            start,
            [check, extends, yes, no],
        ))
    }

    fn next_is(&mut self, token: T) -> P<()> {
        self.next();
        require(self.token() == token && !self.newline_before())
    }

    fn function_type(&mut self, start: u32, op: T, flags: u32) -> P {
        let type_params = self.optional_type_parameters(flag::CONST)?;
        let params = self.parameters(Gap::Open, Owner::Signature)?;
        self.function_type_rest(start, op, flags, type_params, params)
    }

    fn function_type_rest(
        &mut self,
        start: u32,
        op: T,
        flags: u32,
        type_params: Id,
        params: Id,
    ) -> P {
        require(self.eat_infix(T::Arrow))?;
        let return_type = self.return_type()?;
        require(op != T::New || self.kind(return_type) != K::Predicate)?;
        let children = [NONE, type_params, return_type, NONE];
        Some(self.add_function(K::FnType, op, flags, start, children, params))
    }

    pub(super) fn return_type(&mut self) -> P {
        self.require_typescript()?;
        let (start, token) = (self.start(), self.token());
        let mut flags = 0;
        if token == T::Asserts {
            self.next();
            require(!self.newline_before())?;
            flags = flag::ASSERTS;
        } else if !(token.is_identifier() || token == T::This) || !self.is_before_is() {
            return self.ty();
        }
        let name = match self.token() {
            T::This => self.leaf(K::This),
            T::Is => return None,
            _ => self.binding_name()?,
        };
        let mut ty = NONE;
        if self.token() == T::Is {
            require(!self.newline_before())?;
            self.next();
            ty = self.ty()?;
        }
        Some(self.add(
            K::Predicate,
            T::Unknown,
            flags,
            start,
            [name, ty, NONE, NONE],
        ))
    }

    fn is_before_is(&mut self) -> bool {
        let after = self.lx.src.get(self.lx.at.end as usize);
        !matches!(after, Some(b'<' | b'[' | b'.' | b';' | b',' | b')')) && self.peek().0 == T::Is
    }

    fn union(&mut self) -> P {
        self.list_of_types(K::Union, T::Bar, |p| {
            p.list_of_types(K::Intersection, T::Amp, Self::type_operator)
        })
    }

    #[inline]
    fn list_of_types(&mut self, kind: K, separator: T, member: impl Fn(&mut Self) -> P) -> P {
        let start = self.start();
        let has_leading_separator = self.eat(separator);
        let first = member(self)?;
        if self.token() != separator {
            return (!has_leading_separator).then_some(first);
        }
        let base = self.list_base();
        self.push(first);
        while self.eat_infix(separator) {
            let next = member(self)?;
            self.push(next);
        }
        let members = self.buffers.stack.get(base..)?;
        self.odd_if(members.iter().any(|&it| self.kind(it) == K::Intersection));
        self.add_list(kind, 0, start, base)
    }

    fn type_operator(&mut self) -> P {
        let (start, op) = (self.start(), self.token());
        match op {
            T::Keyof | T::Readonly | T::Unique => {
                self.pass_keyword();
                self.enter()?;
                let operand = self.type_operator()?;
                self.leave();
                self.odd_if(self.kind(operand) == K::TypeOperator);
                let node = self.node(operand);
                let is_bare = !node.has(flag::PARENS);
                require(match op {
                    T::Readonly => matches!(node.kind, K::ArrayType | K::Tuple) && is_bare,
                    T::Unique => node.kind == K::TypeKeyword && node.op == T::Symbol && is_bare,
                    _ => true,
                })?;
                Some(self.add(K::TypeOperator, op, 0, start, [operand, NONE, NONE, NONE]))
            }
            T::Infer => {
                require(self.has(ctx::INFER))?;
                self.next();
                let param_start = self.start();
                let name = self.type_name()?;
                let mut constraint = NONE;
                if self.eat(T::Extends) {
                    constraint = self.with(self.ctx | ctx::NO_CONDITIONAL_TYPE, Self::ty)?;
                    let is_certain =
                        self.has(ctx::NO_CONDITIONAL_TYPE) || self.token() != T::Question;
                    require(is_certain)?;
                }
                let param = self.add2(K::TypeParam, param_start, name, constraint);
                Some(self.add1(K::Infer, start, param))
            }
            _ => self.with(self.ctx & !ctx::UNTIL_BRACKET, Self::postfix_type),
        }
    }

    fn postfix_type(&mut self) -> P {
        let start = self.start();
        let mut ty = self.primary_type()?;
        let mut count = 0;
        while self.token() == T::OpenBracket && !self.newline_before() {
            self.odd_if(matches!(self.kind(ty), K::TypeQuery | K::ImportType));
            self.pass(Gap::None, Gap::None);
            ty = match self.eat_suffix(T::CloseBracket) {
                true => self.add1(K::ArrayType, start, ty),
                false => {
                    let index = self.ty()?;
                    require(self.eat_suffix(T::CloseBracket))?;
                    self.add2(K::IndexedAccess, start, ty, index)
                }
            };
            self.add_link(&mut count)?;
        }
        Some(ty)
    }

    fn primary_type(&mut self) -> P {
        let (start, token) = (self.start(), self.token());
        match token {
            T::Ident => self.type_reference(),
            _ if is_type_keyword(token) => {
                let id = self.leaf(K::TypeKeyword);
                require(!matches!(self.token(), T::Dot | T::Lt | T::Is))?;
                Some(id)
            }
            T::Str | T::Num | T::BigInt | T::True | T::False | T::Minus => {
                let literal = match token {
                    T::Str => self.string()?,
                    T::Num => self.leaf(K::Num),
                    T::BigInt => self.leaf(K::BigInt),
                    T::Minus => {
                        self.next_is(T::Num)?;
                        let number = self.leaf(K::Num);
                        self.add(K::Unary, T::Minus, 0, start, [number, NONE, NONE, NONE])
                    }
                    _ => self.leaf(K::Bool),
                };
                Some(self.add(K::LiteralType, token, 0, start, [literal, NONE, NONE, NONE]))
            }
            T::Template | T::TemplateHead => self.template_of(K::TemplateType, false, Self::ty),
            T::OpenBrace if self.is_mapped_type() => self.mapped_type(start),
            T::OpenBrace => self.type_members(K::TypeLiteral),
            T::OpenBracket => self.tuple(start),
            T::OpenParen => {
                self.next();
                let ty = self.ty()?;
                self.expect(T::CloseParen)?;
                self.flag(ty, flag::PARENS | flag::ODD);
                Some(ty)
            }
            T::Typeof => {
                self.pass_keyword();
                if self.token() == T::Import {
                    return self.import_type(start, flag::TYPEOF);
                }
                require(self.token().is_identifier() || self.token() == T::This)?;
                let name = self.entity_name()?;
                let type_args = self.optional_type_arguments()?;
                Some(self.add2(K::TypeQuery, start, name, type_args))
            }
            T::Import => self.import_type(start, 0),
            T::Component | T::Global | T::Hook | T::Module | T::Namespace | T::Require => {
                self.type_reference()
            }
            _ => None,
        }
    }

    fn entity_name(&mut self) -> P {
        let start = self.start();
        let mut name = self.word()?;
        let mut count = 0;
        while self.eat_between(Gap::None, T::Dot, Gap::None) {
            require(!self.newline_before())?;
            let right = self.word()?;
            name = self.add2(K::QualifiedName, start, name, right);
            self.add_link(&mut count)?;
        }
        Some(name)
    }

    fn type_reference(&mut self) -> P {
        let start = self.start();
        let name = self.entity_name()?;
        let type_args = self.optional_type_arguments()?;
        Some(self.add2(K::TypeRef, start, name, type_args))
    }

    /// At the `extends` of an interface or the `implements` of a class.
    pub(super) fn heritage(&mut self) -> P<()> {
        loop {
            self.next();
            require(self.token() == T::Ident)?;
            let ty = self.type_reference()?;
            self.push(ty);
            if self.token() != T::Comma {
                return Some(());
            }
        }
    }

    fn import_type(&mut self, start: u32, flags: u32) -> P {
        self.next();
        require(self.eat_between(Gap::None, T::OpenParen, Gap::None))?;
        let source = self.string()?;
        require(self.eat_suffix(T::CloseParen))?;
        let name = match self.eat_between(Gap::None, T::Dot, Gap::None) {
            true => self.entity_name()?,
            false => NONE,
        };
        let type_args = self.optional_type_arguments()?;
        Some(self.add(
            K::ImportType,
            T::Unknown,
            flags,
            start,
            [source, name, type_args, NONE],
        ))
    }

    #[inline]
    fn optional_type_arguments(&mut self) -> P {
        match self.token() {
            T::Lt if !self.newline_before() => self.type_arguments(),
            T::Shl => None,
            _ => Some(NONE),
        }
    }

    pub(super) fn type_arguments(&mut self) -> P {
        self.require_typescript()?;
        let (start, base) = (self.start(), self.list_base());
        self.pass(Gap::None, Gap::None);
        let flags = self.in_brackets(|p| p.comma_list(T::Gt, Self::ty))?;
        require(flags == 0 && self.list_base() > base)?;
        self.add_list(K::TypeArgs, 0, start, base)
    }

    #[inline]
    pub(super) fn optional_type_parameters(&mut self, allowed_modifiers: u32) -> P {
        match self.token() {
            T::Lt => self.type_parameters(allowed_modifiers),
            _ => Some(NONE),
        }
    }

    fn type_parameters(&mut self, allowed_modifiers: u32) -> P {
        self.require_typescript()?;
        let (start, base) = (self.start(), self.list_base());
        self.next();
        let mut needs_default = false;
        let flags = self.comma_list(T::Gt, |p| {
            let (start, mut flags) = (p.start(), 0);
            for (word, modifier) in [
                (T::Const, flag::CONST),
                (T::In, flag::IN),
                (T::Out, flag::OUT),
            ] {
                if p.eat(word) {
                    flags |= modifier;
                }
            }
            require(flags & !allowed_modifiers == 0)?;
            let name = p.type_name()?;
            let constraint = match p.eat(T::Extends) {
                true => p.ty()?,
                false => NONE,
            };
            let default = match p.eat(T::Eq) {
                true => p.ty()?,
                false => NONE,
            };
            require(default != NONE || !needs_default)?;
            needs_default = default != NONE;
            let children = [name, constraint, default, NONE];
            Some(p.add(K::TypeParam, T::Unknown, flags, start, children))
        })?;
        require(self.list_base() > base)?;
        self.add_list(K::TypeParams, flags, start, base)
    }

    fn tuple(&mut self, start: u32) -> P {
        let base = self.list_base();
        self.pass_prefix();
        let mut is_after_optional = false;
        let flags = self.comma_list(T::CloseBracket, |p| {
            let start = p.start();
            let mut flags = if p.eat(T::DotDotDot) { flag::REST } else { 0 };
            let is_named = p.token().is_word()
                && p.look_ahead(|p| {
                    p.next();
                    p.eat(T::Question);
                    p.token() == T::Colon
                });
            let id = if is_named {
                let name = p.binding_name()?;
                if p.eat_suffix(T::Question) {
                    require(flags == 0)?;
                    flags = flag::OPTIONAL;
                }
                p.pass(Gap::None, Gap::Space);
                let ty = p.ty()?;
                p.add(
                    K::NamedElement,
                    T::Unknown,
                    flags,
                    start,
                    [name, ty, NONE, NONE],
                )
            } else {
                let ty = p.ty()?;
                if flags != 0 {
                    p.add1(K::RestType, start, ty)
                } else if p.eat(T::Question) {
                    p.odd();
                    flags = flag::OPTIONAL;
                    let node = p.node(ty);
                    let is_postfix = node.has(flag::PARENS)
                        || matches!(
                            node.kind,
                            K::TypeKeyword
                                | K::TypeRef
                                | K::ArrayType
                                | K::TypeLiteral
                                | K::Tuple
                                | K::IndexedAccess
                                | K::TypeQuery
                        );
                    require(is_postfix)?;
                    p.add1(K::OptionalType, start, ty)
                } else {
                    ty
                }
            };
            require(flags != 0 || !is_after_optional)?;
            is_after_optional |= flags == flag::OPTIONAL;
            Some(id)
        })?;
        self.add_list(K::Tuple, flags, start, base)
    }

    fn is_mapped_type(&mut self) -> bool {
        self.look_ahead(|p| {
            p.next();
            if matches!(p.token(), T::Plus | T::Minus) {
                return true;
            }
            p.eat(T::Readonly);
            p.eat(T::OpenBracket) && p.token().is_word() && {
                p.next();
                p.token() == T::In
            }
        })
    }

    fn mapped_type(&mut self, start: u32) -> P {
        self.next();
        let (mut op, mut flags) = (T::Unknown, 0);
        if matches!(self.token(), T::Plus | T::Minus) {
            op = self.token();
            self.next_is(T::Readonly)?;
        }
        if self.eat(T::Readonly) {
            flags |= flag::READONLY;
        }
        self.expect(T::OpenBracket)?;
        let name = self.type_name()?;
        self.expect(T::In)?;
        let constraint = self.ty()?;
        let rename = match self.eat(T::As) {
            true => self.ty()?,
            false => NONE,
        };
        self.expect(T::CloseBracket)?;
        match self.token() {
            T::Plus => flags |= flag::IN,
            T::Minus => flags |= flag::OUT,
            _ => {}
        }
        if flags & (flag::IN | flag::OUT) != 0 {
            self.next_is(T::Question)?;
        }
        if self.eat(T::Question) {
            flags |= flag::OPTIONAL;
        }
        self.expect(T::Colon)?;
        let ty = self.ty()?;
        self.eat(T::Semicolon);
        self.expect(T::CloseBrace)?;
        Some(self.add(K::Mapped, op, flags, start, [name, constraint, rename, ty]))
    }

    pub(super) fn type_members(&mut self, kind: K) -> P {
        let (start, base) = (self.start(), self.list_base());
        require(self.token() == T::OpenBrace)?;
        self.pass_open_brace();
        let mut before_brace = Gap::None;
        while !self.eat_between(before_brace, T::CloseBrace, Gap::Open) {
            let member = self.type_member()?;
            self.push(member);
            if self.eat_separator(T::Semicolon) {
                self.odd_if(self.token() == T::CloseBrace);
            } else if self.eat(T::Comma) {
                self.odd();
            } else {
                require(self.token() == T::CloseBrace || self.newline_before())?;
            }
            before_brace = self.style.inside_braces;
        }
        self.add_list(kind, 0, start, base)
    }

    fn type_member(&mut self) -> P {
        let (start, token) = (self.start(), self.token());
        if token == T::New && matches!(self.peek().0, T::OpenParen | T::Lt) {
            self.next();
        }
        if matches!(self.token(), T::OpenParen | T::Lt) {
            let value = self.bare_signature(Gap::Open)?;
            return Some(self.add(K::CallSignature, token, 0, start, [NONE, value, NONE, NONE]));
        }
        let (mut op, mut flags) = (T::OpenParen, 0);
        if matches!(token, T::Readonly | T::Get | T::Set) && self.is_followed_by_key()? {
            self.pass_keyword();
            match token {
                T::Readonly => flags = flag::READONLY,
                _ => op = token,
            }
        }
        if self.token() == T::OpenBracket && self.is_index_signature() {
            require(op == T::OpenParen)?;
            return self.index_signature(start, flags);
        }
        let (key, key_flags) = self.property_key()?;
        if key_flags != 0 {
            let node = self.node(key);
            let is_name = matches!(node.kind, K::Ident | K::Dot) && !node.has(flag::CHAIN);
            require(is_name)?;
        }
        flags |= key_flags;
        if self.eat_suffix(T::Question) {
            require(op == T::OpenParen)?;
            flags |= flag::OPTIONAL;
        }
        if matches!(self.token(), T::OpenParen | T::Lt) {
            require(flags & flag::READONLY == 0)?;
            let value = self.bare_signature(Gap::None)?;
            self.check_accessor(op, value)?;
            return Some(self.add(
                K::MethodSignature,
                op,
                flags,
                start,
                [key, value, NONE, NONE],
            ));
        }
        require(op == T::OpenParen && self.token() == T::Colon)?;
        let ty = self.optional_type_annotation()?;
        Some(self.add(
            K::PropertySignature,
            T::Unknown,
            flags,
            start,
            [key, ty, NONE, NONE],
        ))
    }

    fn bare_signature(&mut self, before: Gap) -> P {
        let start = self.start();
        let (type_params, params, return_type) = self.signature(before, Owner::Signature)?;
        let children = [NONE, type_params, return_type, NONE];
        Some(self.add_function(K::Fn, T::Unknown, 0, start, children, params))
    }

    pub(super) fn is_index_signature(&mut self) -> bool {
        self.look_ahead(|p| {
            p.next();
            p.token().is_word() && {
                p.next();
                matches!(p.token(), T::Colon | T::Comma | T::Question)
            }
        })
    }

    pub(super) fn index_signature(&mut self, start: u32, flags: u32) -> P {
        self.require_typescript()?;
        self.next();
        let param_start = self.start();
        let name = self.binding_name()?;
        self.expect(T::Colon)?;
        let key = self.ty()?;
        let node = self.node(key);
        let is_allowed = matches!(node.op, T::String | T::Number | T::Symbol);
        require(
            node.kind == K::TypeKeyword && is_allowed
                || node.kind == K::TemplateType && node.len > 1,
        )?;
        let param = self.add2(K::Param, param_start, name, key);
        self.expect(T::CloseBracket)?;
        self.expect(T::Colon)?;
        let ty = self.ty()?;
        Some(self.add(
            K::IndexSignature,
            T::Unknown,
            flags,
            start,
            [param, ty, NONE, NONE],
        ))
    }
}
