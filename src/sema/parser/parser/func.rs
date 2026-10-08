//! Functions: declarations, expressions, arrow functions, parameters.

use super::stmt::Start;
use super::{Parser, ctx, take_span};
use crate::Refusal;
use crate::token::T;
use bun_sema::atom::{Atom, known};
use bun_sema::hir::*;

/// `Tristate`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Tristate {
    False,
    True,
    Unknown,
}

/// The context of the parameters and the body of a function with `flags`.
#[inline]
fn signature_context(flags: Flags) -> u32 {
    let mut context = 0;
    if flags.contains(Flags::GENERATOR) {
        context |= ctx::YIELD;
    }
    if flags.contains(Flags::ASYNC) {
        context |= ctx::AWAIT;
    }
    context
}

impl Parser<'_> {
    /// `parseFunctionDeclaration`
    pub(crate) fn function_declaration(&mut self, start: Start, base: usize, flags: Flags) -> StmtId {
        self.next();
        let mut fn_flags =
            self.ambient() | flags & (Flags::EXPORT | Flags::DEFAULT | Flags::ASYNC);
        if self.eat(T::Asterisk) {
            fn_flags |= Flags::GENERATOR;
        }
        let (name, name_pos) = if self.is_binding_identifier() {
            let name = (self.lx.atom, self.pos());
            self.note_identifier(name.0, name.1);
            self.next();
            name
        } else {
            if !flags.contains(Flags::DEFAULT) {
                self.fail();
            }
            // A default export without a name is placed at `export`.
            let is_export = |it: &&Modifier| it.kind == ModifierKind::Keyword(Flags::EXPORT);
            let modifiers = self.s.modifiers.get(base..).unwrap_or_default();
            (Atom::NONE, modifiers.iter().rfind(is_export).map_or(start.pos, |it| it.pos))
        };
        let func = self.function_rest(FnKind::Decl, fn_flags, name, name_pos, start.pos);
        let modifiers = self.take_modifiers(base);
        self.add_stmt(StmtKind::Fn(func), start, modifiers)
    }

    /// `parseFunctionExpression`
    pub(crate) fn function_expression(&mut self) -> ExprId {
        let start = self.pos();
        let mut flags = Flags::empty();
        if self.eat(T::Async) {
            flags |= Flags::ASYNC;
        }
        self.expect(T::Function);
        if self.eat(T::Asterisk) {
            flags |= Flags::GENERATOR;
        }
        // Its name is read in the context of its body.
        let saved = self.enter_context(signature_context(flags), ctx::YIELD | ctx::AWAIT);
        let (mut name, mut name_pos) = (Atom::NONE, start);
        if self.is_binding_identifier() {
            (name, name_pos) = (self.lx.atom, self.pos());
            self.note_identifier(name, name_pos);
            self.next();
        }
        self.context = saved;
        let saved = self.enter_context(0, ctx::DECORATOR);
        let func = self.function_rest(FnKind::Expr, flags, name, name_pos, start);
        self.context = saved;
        if !has_body(&self.f[func]) {
            self.fail();
        }
        self.finish_expr(ExprKind::Fn(func), start)
    }

    /// From the type parameters of a function to the end of its body.
    pub(crate) fn function_rest(
        &mut self,
        kind: FnKind,
        flags: Flags,
        name: Atom,
        name_pos: u32,
        start: u32,
    ) -> FnId {
        let type_params = self.type_parameters();
        let anchor = self.pos();
        let (this_param, params) = self.parameters(signature_context(flags));
        let ret = match self.token() {
            T::Colon => {
                self.next();
                self.type_or_type_predicate()
            }
            _ => TypeNodeId::NONE,
        };
        // `parseFunctionBlockOrSemicolon`
        let (body, open) = match self.token() {
            T::OpenBrace => self.function_block(signature_context(flags)),
            _ => {
                self.semicolon();
                (FnBody::None, 0)
            }
        };
        // Without a body the whole is reported.
        if self.options.is_javascript && !matches!(body, FnBody::None) {
            self.js_error_at_type(ret, 8010);
        }
        let func = self.f.add_fn(Func {
            kind,
            flags,
            name,
            name_pos,
            type_params,
            params,
            this_param,
            ret,
            body,
            anchor,
            start,
        });
        if matches!(body, FnBody::Block(_)) {
            self.f.body_starts.push((func, open));
        }
        func
    }

    /// `parseFunctionBlock`, at the `{`: the body, and the position of the `{`.
    pub(crate) fn function_block(&mut self, context: u32) -> (FnBody, u32) {
        let open = self.pos();
        let cleared = ctx::YIELD | ctx::AWAIT | ctx::TOP_LEVEL | ctx::DECORATOR;
        let cleared = cleared | self.disallow_in_if_brackets_end_it();
        let saved = self.enter_context(context, cleared);
        self.next();
        let list = self.statements_until_close_brace();
        self.context = saved;
        self.expect(T::CloseBrace);
        (FnBody::Block(list), open)
    }

    // ───────────────────────────── parameters ─────────────────────────────

    /// `parseTypeParameters`
    pub(crate) fn type_parameters(&mut self) -> Span<TypeParamId> {
        if self.token() != T::LessThan {
            return Span::EMPTY;
        }
        self.next();
        let base = self.s.type_params.len();
        while self.is_in_list(T::GreaterThan) {
            // `parseTypeParameter`
            let start = self.pos();
            let modifiers = self.s.modifiers.len();
            let flags = match self.token().is_modifier() {
                true => self.modifiers(false, true, false),
                false => Flags::empty(),
            };
            if flags.intersects(!(Flags::IN | Flags::OUT | Flags::CONST)) {
                self.report();
            }
            let (name, pos) = self.identifier();
            let constraint = match self.eat(T::Extends) {
                true => self.ty(),
                false => TypeNodeId::NONE,
            };
            let default = match self.eat(T::Equals) {
                true => self.ty(),
                false => TypeNodeId::NONE,
            };
            let end = self.prev_end();
            let modifiers = self.take_modifiers(modifiers);
            self.s.type_params.push(TypeParam {
                name,
                pos,
                start,
                end,
                constraint,
                default,
                flags,
                modifiers,
            });
            if !self.eat(T::Comma) {
                break;
            }
        }
        if self.s.type_params.len() == base {
            // An empty list is an error.
            self.refuse(Refusal::Reported);
        }
        if self.options.is_javascript
            && let [first, .., last] | [first @ last] = self.s.type_params[base..]
        {
            self.js_error((first.start, last.end), 8004, b"");
        }
        self.expect(T::GreaterThan);
        take_span!(self, type_params, base)
    }

    /// `parseParameters`, at the `(`: the `this` parameter, and the others. `context`: that of the
    /// function.
    pub(crate) fn parameters(&mut self, context: u32) -> (ParamId, Span<ParamId>) {
        self.expect(T::OpenParen);
        let list = self.parameter_list(context, T::CloseParen);
        self.expect(T::CloseParen);
        // `GetThisParameter`: the first, if it is named `this`.
        let first = self.f.params.get(list.start as usize).filter(|_| !list.is_empty());
        let name = first.and_then(|first| self.f.pats.get(first.pat.idx()));
        match name {
            Some(Pat {
                kind: PatKind::Ident(known::this),
                ..
            }) => (ParamId(list.start), Span::new(list.start + 1, list.len - 1)),
            _ => (ParamId::NONE, list),
        }
    }

    /// `parseParametersWorker`
    pub(crate) fn parameter_list(&mut self, context: u32, close: T) -> Span<ParamId> {
        let outer_await = self.context & ctx::AWAIT;
        let cleared = ctx::YIELD | ctx::AWAIT | ctx::TOP_LEVEL;
        let cleared = cleared | self.disallow_in_if_brackets_end_it();
        let saved = self.enter_context(context, cleared);
        let base = self.s.params.len();
        let modifiers = self.s.param_modifiers.len();
        let decorators = self.s.decorators.len();
        while self.is_in_list(close) {
            self.parameter(base, outer_await);
            if !self.eat(T::Comma) {
                break;
            }
        }
        self.context = saved;
        let params: Span<ParamId> = take_span!(self, params, base);
        for index in modifiers..self.s.param_modifiers.len() {
            let (param, list) = self.s.param_modifiers[index];
            self.f.set_param_modifiers(params.at(param as usize), list);
        }
        self.s.param_modifiers.truncate(modifiers);
        for index in decorators..self.s.decorators.len() {
            let (param, decorator) = self.s.decorators[index];
            let owner = DecoratorOwner::Param(params.at(param as usize));
            self.f.decorators.push((owner, decorator));
        }
        self.s.decorators.truncate(decorators);
        params
    }

    /// `parseParameterEx`: pushes it on the stack of parameters, of which the list's start at
    /// `base`.
    fn parameter(&mut self, base: usize, outer_await: u32) {
        const PROPERTY_MODIFIERS: Flags = Flags::PUBLIC
            .union(Flags::PRIVATE)
            .union(Flags::PROTECTED)
            .union(Flags::READONLY)
            .union(Flags::OVERRIDE);
        let start = self.start();
        let mut flags = Flags::empty();
        let token = self.token();
        if token.is_modifier() || token == T::At {
            // "Decorators are parsed in the outer [Await] context, the rest of the parameter is
            // parsed in the function's [Await] context."
            let first = self.s.modifiers.len();
            let saved = self.enter_context(outer_await, ctx::AWAIT);
            let seen = self.modifiers(true, false, false);
            self.context = saved;
            let index = (self.s.params.len() - base) as u32;
            for modifier in first..self.s.modifiers.len() {
                if let ModifierKind::Decorator(decorator) = self.s.modifiers[modifier].kind {
                    self.s.decorators.push((index, decorator));
                }
            }
            if seen.intersects(!PROPERTY_MODIFIERS) {
                self.refuse(Refusal::Reported);
            }
            flags |= seen;
            if !seen.is_empty() {
                flags |= Flags::PARAMETER_PROPERTY;
            }
            if self.options.is_javascript {
                self.check_js_parameter_modifiers(first, start.pos);
            }
            let list = self.take_modifiers(first);
            if !list.is_empty() {
                self.s.param_modifiers.push((index, list));
            }
        }
        let pat;
        let is_this = self.token() == T::This;
        if is_this {
            pat = self.f.pat(PatKind::Ident(known::this), self.lx.start, self.lx.end);
            self.next();
            // A decorator of `this` is an error of the parser.
            if token.is_modifier() || token == T::At {
                self.refuse(Refusal::Reported);
            }
        } else {
            if self.eat(T::DotDotDot) {
                flags |= Flags::REST;
            }
            pat = self.identifier_or_pattern();
            if self.token() == T::Question {
                self.js_error((self.pos(), 0), 8009, b"?");
                self.next();
                flags |= Flags::OPTIONAL;
            }
        }
        let ty = self.type_annotation();
        // `this` has none.
        let default = match is_this {
            true => ExprId::NONE,
            false => self.optional_initializer(),
        };
        self.s.params.push(Param {
            pat,
            ty,
            default,
            flags,
            pos: start.pos,
            loc: TextRange {
                pos: start.full,
                end: self.prev_end(),
            },
        });
    }

    /// `checkJSSyntax` for the modifiers of the parameter that starts at `start`, which are on the
    /// stack from `first` on: `node.Modifiers().Loc`, if a keyword is among them.
    #[cold]
    fn check_js_parameter_modifiers(&mut self, first: usize, start: u32) {
        if self.has_failed() {
            return;
        }
        let modifiers = self.s.modifiers.get(first..).unwrap_or_default();
        let end_of = |it: &Modifier| match it.kind {
            ModifierKind::Keyword(flag) => it.pos + modifier_text(flag).len() as u32,
            ModifierKind::Decorator(e) => end_of_expr(&self.f, e),
        };
        let is_keyword = |it: &Modifier| matches!(it.kind, ModifierKind::Keyword(_));
        if modifiers.iter().any(is_keyword)
            && let Some(end) = modifiers.iter().map(end_of).max()
        {
            self.js_error((start, end), 8012, b"");
        }
    }

    // ───────────────────────────── arrow functions ─────────────────────────────

    /// `tryParseParenthesizedArrowFunctionExpression` and
    /// `tryParseAsyncSimpleArrowFunctionExpression`, at a `(`, a `<` or `async`.
    pub(crate) fn try_arrow_function(&mut self, allow_return_type: bool) -> Option<ExprId> {
        match self.look_ahead(Self::is_parenthesized_arrow_function) {
            Tristate::True => {
                return self.parenthesized_arrow_function(true, true);
            }
            Tristate::Unknown => {
                // `parsePossibleParenthesizedArrowFunctionExpression`
                let at = self.pos();
                if !self.not_arrows.contains(&at) {
                    let arrow = self
                        .try_parse(|p| p.parenthesized_arrow_function(false, allow_return_type));
                    if arrow.is_some() {
                        return arrow;
                    }
                    self.not_arrows.push(at);
                }
            }
            Tristate::False => {}
        }
        if self.token() != T::Async {
            return None;
        }
        // `isUnParenthesizedAsyncArrowFunctionWorker`
        let is_arrow = self.look_ahead(|p| {
            p.next();
            if p.newline_before() || !p.is_identifier() {
                return false;
            }
            p.next();
            p.token() == T::EqualsGreaterThan && !p.newline_before()
        });
        if !is_arrow {
            return None;
        }
        let start = self.pos();
        self.next();
        let full = self.full_start();
        let (name, pos, end) = (self.lx.atom, self.lx.start, self.lx.end);
        self.note_identifier(name, pos);
        self.next();
        Some(self.simple_arrow_function(name, (pos, end, full), true, start, allow_return_type))
    }

    /// `isParenthesizedArrowFunctionExpressionWorker`
    fn is_parenthesized_arrow_function(&mut self) -> Tristate {
        if self.token() == T::Async {
            self.next();
            if self.newline_before() || !matches!(self.token(), T::OpenParen | T::LessThan) {
                return Tristate::False;
            }
        }
        let first = self.token();
        self.next();
        let second = self.token();
        if first == T::OpenParen {
            match second {
                // "Simple cases: '() =>', '(): ', and '() {'."
                T::CloseParen => {
                    self.next();
                    return match self.token() {
                        T::EqualsGreaterThan | T::Colon | T::OpenBrace => Tristate::True,
                        _ => Tristate::False,
                    };
                }
                // "If encounter '([' or '({', this could be the start of a binding pattern."
                T::OpenBracket | T::OpenBrace => return Tristate::Unknown,
                // "Simple case: '(...'"
                T::DotDotDot => return Tristate::True,
                _ => {}
            }
            // "Check for '(xxx yyy', where xxx is a modifier and yyy is an identifier."
            if second.is_modifier() && second != T::Async {
                let is_before_identifier = self.look_ahead(|p| {
                    p.next();
                    p.is_identifier()
                });
                if is_before_identifier {
                    self.next();
                    return match self.token() {
                        T::As => Tristate::False,
                        _ => Tristate::True,
                    };
                }
            }
            // "If we had '(' followed by something that's not an identifier, then this definitely
            // wasn't a lambda."
            if !self.is_identifier() && second != T::This {
                return Tristate::False;
            }
            self.next();
            match self.token() {
                // "If we have something like '(a:', then we must have a type-annotated parameter"
                T::Colon => Tristate::True,
                T::Question => {
                    self.next();
                    // "If we have '(a?:' or '(a?,' or '(a?=' or '(a?)' then it is definitely a
                    // lambda."
                    match self.token() {
                        T::Colon | T::Comma | T::Equals | T::CloseParen => Tristate::True,
                        _ => Tristate::False,
                    }
                }
                // "If we have '(a,' or '(a=' or '(a)' this *could* be an arrow function"
                T::Comma | T::Equals | T::CloseParen => Tristate::Unknown,
                _ => Tristate::False,
            }
        } else {
            // "If we have '<' not followed by an identifier, then this definitely is not an arrow
            // function."
            if !self.is_identifier() && self.token() != T::Const {
                return Tristate::False;
            }
            if !self.options.is_jsx {
                return Tristate::Unknown;
            }
            // "JSX overrides"
            self.eat(T::Const);
            self.next();
            match self.token() {
                T::Extends => {
                    self.next();
                    match self.token() {
                        T::Equals | T::GreaterThan | T::Slash => Tristate::False,
                        _ => Tristate::True,
                    }
                }
                T::Comma | T::Equals => Tristate::True,
                _ => Tristate::False,
            }
        }
    }

    /// `parseParenthesizedArrowFunctionExpression`
    fn parenthesized_arrow_function(
        &mut self,
        allow_ambiguity: bool,
        allow_return_type: bool,
    ) -> Option<ExprId> {
        let start = self.pos();
        let mut flags = Flags::empty();
        if self.eat(T::Async) {
            flags |= Flags::ASYNC;
        }
        let type_params = self.type_parameters();
        let (this_param, params) = self.parameters(signature_context(flags));
        let has_return_colon = self.token() == T::Colon;
        let ret = match has_return_colon {
            true => {
                self.next();
                self.type_or_type_predicate()
            }
            false => TypeNodeId::NONE,
        };
        if self.token() != T::EqualsGreaterThan {
            // Before a `{` TypeScript takes it for an arrow function whose `=>` is missing.
            if self.token() == T::OpenBrace && !self.has_failed() {
                self.refuse(Refusal::Reported);
            }
            if allow_ambiguity {
                self.fail();
            }
            return None;
        }
        let anchor = self.pos();
        self.next();
        let (body, open) = self.arrow_function_body(flags, allow_return_type);
        // "Given: x ? y => ({ y }) : z => ({ z }) .. we only allow a return type if it is followed
        // by a colon"
        if !allow_return_type && has_return_colon && self.token() != T::Colon {
            return None;
        }
        if self.has_failed() {
            return None;
        }
        if self.options.is_javascript {
            self.js_error_at_type(ret, 8010);
        }
        let func = self.f.add_fn(Func {
            kind: FnKind::Arrow,
            flags,
            name: Atom::NONE,
            name_pos: start,
            type_params,
            params,
            this_param,
            ret,
            body,
            anchor,
            start,
        });
        if matches!(body, FnBody::Block(_)) {
            self.f.body_starts.push((func, open));
        }
        Some(self.finish_expr(ExprKind::Fn(func), start))
    }

    /// `parseArrowFunctionExpressionBody`: the body, and the position of its `{`.
    fn arrow_function_body(&mut self, flags: Flags, allow_return_type: bool) -> (FnBody, u32) {
        let context = signature_context(flags);
        if self.token() == T::OpenBrace {
            return self.function_block(context);
        }
        let saved = self.enter_context(context, ctx::YIELD | ctx::AWAIT | ctx::TOP_LEVEL);
        let body = self.assignment_expression_or_higher(allow_return_type);
        self.context = saved;
        (FnBody::Expr(body), 0)
    }

    /// `parseSimpleArrowFunctionExpression`, at the `=>`. `name`: that of the parameter, with its
    /// start, its end and its full start.
    pub(crate) fn simple_arrow_function(
        &mut self,
        name: Atom,
        (pos, end, full): (u32, u32, u32),
        is_async: bool,
        start: u32,
        allow_return_type: bool,
    ) -> ExprId {
        let pat = self.f.pat(PatKind::Ident(name), pos, end);
        let param = self.f.add_param(Param {
            pat,
            ty: TypeNodeId::NONE,
            default: ExprId::NONE,
            flags: Flags::empty(),
            pos,
            loc: TextRange { pos: full, end },
        });
        let anchor = self.pos();
        self.next();
        let flags = match is_async {
            true => Flags::ASYNC,
            false => Flags::empty(),
        };
        let (body, open) = self.arrow_function_body(flags, allow_return_type);
        let func = self.f.add_fn(Func {
            kind: FnKind::Arrow,
            flags,
            name: Atom::NONE,
            name_pos: start,
            type_params: Span::EMPTY,
            params: Span::new(param.0, 1),
            this_param: ParamId::NONE,
            ret: TypeNodeId::NONE,
            body,
            anchor,
            start,
        });
        if matches!(body, FnBody::Block(_)) {
            self.f.body_starts.push((func, open));
        }
        self.finish_expr(ExprKind::Fn(func), start)
    }
}
