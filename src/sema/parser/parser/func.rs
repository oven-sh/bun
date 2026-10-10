//! Functions: declarations, expressions, arrow functions, parameters.

use super::stmt::{ModifiersOf, Start};
use super::{ListKind, Parser, ctx, take_span};
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

/// `allowAmbiguity`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Ambiguity {
    Allowed,
    /// What is not surely a list of parameters is none.
    Refused,
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

impl<const GENERAL: bool> Parser<'_, GENERAL> {
    /// `parseFunctionDeclaration`
    pub(crate) fn function_declaration(
        &mut self,
        start: Start,
        base: usize,
        flags: Flags,
    ) -> StmtId {
        // Only its modifiers say that `default function f() {}` has `default`.
        let flags = match flags.contains(Flags::EXPORT) {
            true => flags,
            false => flags - Flags::DEFAULT,
        };
        self.next();
        let mut fn_flags = self.ambient() | flags & (Flags::EXPORT | Flags::DEFAULT | Flags::ASYNC);
        if self.eat(T::Asterisk) {
            fn_flags |= Flags::GENERATOR;
        }
        let (name, name_pos) = if self.is_binding_identifier() {
            let name = (self.lx.atom, self.pos());
            self.note_identifier(name.0, name.1);
            self.next_after_name();
            name
        } else if !flags.contains(Flags::DEFAULT) {
            let full = self.full_start();
            match self.missing_identifier(0, 0) {
                (known::empty, _) => (known::empty, full),
                name => name,
            }
        } else {
            // A default export without a name is placed at `export`.
            let is_export = |it: &&Modifier| it.kind == ModifierKind::Keyword(Flags::EXPORT);
            let modifiers = self.s.modifiers.get(base..).unwrap_or_default();
            (
                Atom::NONE,
                modifiers
                    .iter()
                    .rfind(is_export)
                    .map_or(start.pos, |it| it.pos),
            )
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
            self.next_after_name();
        }
        self.context = saved;
        let saved = self.enter_context(0, ctx::DECORATOR);
        let func = self.function_rest(FnKind::Expr, flags, name, name_pos, start);
        self.context = saved;
        if !has_body(&self.f[func]) {
            self.fail_unless_recovering();
        }
        if self.reads_jsdoc() {
            self.function_jsdoc(func, start);
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
        // "'{' or ';' expected."
        let code = match kind {
            FnKind::Decl => 1144,
            _ => 1005,
        };
        self.function_rest_or(code, kind, flags, (name, name_pos), start)
    }

    /// The same. `code`: the error about a token that neither starts nor stands for the body.
    pub(crate) fn function_rest_or(
        &mut self,
        code: u32,
        kind: FnKind,
        mut flags: Flags,
        (name, name_pos): (Atom, u32),
        start: u32,
    ) -> FnId {
        let type_params = self.type_parameters();
        let anchor = match self.token() {
            T::OpenParen => self.pos(),
            // `createMissingList`
            _ => self.full_start().saturating_sub(1),
        };
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
            // `parseBlock` without its `{`
            _ if kind == FnKind::Expr || self.recovers() && !self.can_parse_semicolon() => {
                match code {
                    1005 => self.expected(T::OpenBrace),
                    code => self.error_at_token(code, &[]),
                }
                flags |= Flags::MISSING_BODY;
                (FnBody::None, 0)
            }
            _ => {
                // Flow has a function without a body only where it is declared.
                if self.is_flow && !self.has_context(ctx::AMBIENT) {
                    self.fail();
                }
                self.semicolon();
                (FnBody::None, 0)
            }
        };
        // Without a body the whole is reported.
        if self.options.is_javascript
            && (!matches!(body, FnBody::None) || flags.contains(Flags::MISSING_BODY))
        {
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
        // Only a block whose `{` is put up with has none.
        let open_at = self.expect(T::OpenBrace).then_some(open);
        let list = self.statements_until_close_brace();
        self.context = saved;
        self.expect_matching((T::OpenBrace, T::CloseBrace), open_at);
        if self.token() == T::Equals {
            self.equals_after_block();
        }
        (FnBody::Block(list), open)
    }

    // ───────────────────────────── parameters ─────────────────────────────

    /// `checkGrammarTypeParameterList`, of a list from `less_than` to the token in which there is
    /// something, but no parameter. The checker finds `<>` in the text.
    #[cold]
    #[inline(never)]
    fn empty_type_parameters(&mut self, less_than: u32) {
        if self.token() != T::GreaterThan || self.prev_end() != less_than + 1 {
            let list = (less_than, self.pos() + 1);
            self.flag(DiagnosticKind::Grammar, 1098, list, &[]);
        }
    }

    /// `parseTypeParameters`
    pub(crate) fn type_parameters(&mut self) -> Span<TypeParamId> {
        if self.token() != T::LessThan {
            return Span::EMPTY;
        }
        if self.is_flow {
            return self.flow_type_parameters();
        }
        let less_than = self.pos();
        self.next();
        let base = self.s.type_params.len();
        let lists = self.enter_list(ListKind::TypeParameters);
        while self.is_in_list(T::GreaterThan) && self.is_at_element(ListKind::TypeParameters) {
            // `isListElement`
            if !matches!(self.token(), T::In | T::Const) && !self.is_identifier() {
                self.fail();
            }
            // `parseTypeParameter`
            let element = self.full_start();
            let start = self.pos();
            let modifiers = self.s.modifiers.len();
            let flags = match self.token().is_modifier() {
                true => self.modifiers(ModifiersOf::TypeParameter),
                false => Flags::empty(),
            };
            // The checker reports the others, which are in the list.
            let flags = flags & (Flags::IN | Flags::OUT | Flags::CONST);
            let (name, pos, start) = if self.is_identifier() {
                let (name, pos) = (self.lx.atom, self.pos());
                self.note_identifier(name, pos);
                self.next_after_name();
                (name, pos, start)
            } else {
                self.missing_name_of_type_parameter(start)
            };
            let constraint = match self.eat(T::Extends) {
                true if !self.is_start_of_type(false) && self.is_start_of_expression() => {
                    self.expression_in_place_of_constraint();
                    TypeNodeId::NONE
                }
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
            if !self.eat(T::Comma) && !self.goes_on_without_comma(ListKind::TypeParameters, element)
            {
                break;
            }
        }
        self.leave_list(lists);
        if self.recovers() && self.s.type_params.len() == base {
            self.empty_type_parameters(less_than);
        }
        if self.options.is_javascript
            && let [first, .., last] | [first @ last] = self.s.type_params[base..]
        {
            self.js_error((first.start, last.end), 8004, b"");
        } else if self.is_ecmascript {
            self.report();
        }
        self.expect(T::GreaterThan);
        take_span!(self, type_params, base)
    }

    /// `parseIdentifier` in `parseTypeParameter`, at none: the name, its position, the new `start`.
    #[cold]
    #[inline(never)]
    fn missing_name_of_type_parameter(&mut self, start: u32) -> (Atom, u32, u32) {
        let (full, token) = (self.full_start(), self.pos());
        match self.missing_identifier(0, 0) {
            // Without modifiers the type parameter is nothing but the name, at `nodePos()`.
            (known::empty, _) if start == token => (known::empty, full, full),
            (known::empty, _) => (known::empty, full, start),
            (name, pos) => (name, pos, start),
        }
    }

    /// `parseUnaryExpressionOrHigher` in `parseTypeParameter`: the tree has no place for it.
    #[cold]
    #[inline(never)]
    fn expression_in_place_of_constraint(&mut self) {
        if !self.recovers() {
            return self.fail();
        }
        if self.is_too_deep() {
            return;
        }
        // `checkTypeParameter`
        self.flag(DiagnosticKind::Grammar, 1110, self.range_of_token(), &[]);
        let before = self.checkpoint();
        let strays = self.s.stray_decorators.len();
        self.unary_expression();
        self.s.stray_decorators.truncate(strays);
        self.forget_nodes(&before);
    }

    /// `parseParameters`, at the `(`: the `this` parameter, and the others. `context`: that of the
    /// function.
    pub(crate) fn parameters(&mut self, context: u32) -> (ParamId, Span<ParamId>) {
        self.parameters_if(context, Ambiguity::Allowed)
            .unwrap_or((ParamId::NONE, Span::EMPTY))
    }

    /// The same, as `parseParenthesizedArrowFunctionExpression` has it.
    fn parameters_if(
        &mut self,
        context: u32,
        ambiguity: Ambiguity,
    ) -> Option<(ParamId, Span<ParamId>)> {
        if !self.expect(T::OpenParen) {
            // `createMissingList`
            return (ambiguity == Ambiguity::Allowed).then_some((ParamId::NONE, Span::EMPTY));
        }
        let list = self.parameter_list_if(context, T::CloseParen, ambiguity)?;
        if !self.expect(T::CloseParen) && ambiguity == Ambiguity::Refused {
            return None;
        }
        // `GetThisParameter`: the first, if it is named `this`.
        let first = self
            .f
            .params
            .get(list.start as usize)
            .filter(|_| !list.is_empty());
        let name = first.and_then(|first| self.f.pats.get(first.pat.idx()));
        Some(match name {
            Some(Pat {
                kind: PatKind::Ident(known::this),
                ..
            }) => (ParamId(list.start), Span::new(list.start + 1, list.len - 1)),
            _ => (ParamId::NONE, list),
        })
    }

    /// `parseParametersWorker`
    pub(crate) fn parameter_list(&mut self, context: u32, close: T) -> Span<ParamId> {
        self.parameter_list_if(context, close, Ambiguity::Allowed)
            .unwrap_or(Span::EMPTY)
    }

    /// After two or more parameters, which are on the stack from `base` on: `hir::File::may_bind_a_parameter_twice`.
    #[inline]
    fn note_names_of_parameters(&mut self, base: usize) {
        let (pats, params) = (&self.f.pats, self.s.params.get(base..).unwrap_or_default());
        let name_of = |it: &Param| match pats.get(it.pat.idx()) {
            Some(&Pat {
                kind: PatKind::Ident(name),
                ..
            }) => name,
            // What a pattern binds is not looked at here.
            _ => Atom::NONE,
        };
        // A long list is not compared, each name with each.
        if params.len() > 8 {
            self.f.may_bind_a_parameter_twice = true;
            return;
        }
        let mut rest = params;
        while let [first, others @ ..] = rest {
            let name = name_of(first);
            if name.is_none() || others.iter().any(|it| name_of(it) == name) {
                self.f.may_bind_a_parameter_twice = true;
                return;
            }
            rest = others;
        }
    }

    /// `parseParametersWorker`. `None`: it is no list of parameters, and what was built is left to
    /// the speculative parse that is going on.
    fn parameter_list_if(
        &mut self,
        context: u32,
        close: T,
        ambiguity: Ambiguity,
    ) -> Option<Span<ParamId>> {
        let outer_await = self.context & ctx::AWAIT;
        let cleared = ctx::YIELD | ctx::AWAIT | ctx::TOP_LEVEL;
        let cleared = cleared | self.disallow_in_if_brackets_end_it();
        let saved = self.enter_context(context, cleared);
        let base = self.s.params.len();
        let modifiers = self.s.param_modifiers.len();
        let decorators = self.s.decorators.len();
        let lists = self.enter_list(ListKind::Parameters);
        while self.is_in_list(close) && self.is_at_parameter() {
            let element = self.full_start();
            if !self.parameter(base, outer_await, ambiguity) {
                return None;
            }
            if !self.eat(T::Comma) && !self.goes_on_without_comma(ListKind::Parameters, element) {
                break;
            }
        }
        self.leave_list(lists);
        self.context = saved;
        if self.s.params.len() > base + 1 {
            self.note_names_of_parameters(base);
        }
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
        if self.reads_jsdoc() {
            // `withJSDoc` of a parameter: in the context of the list.
            let saved = self.enter_context(context, cleared);
            self.parameters_jsdoc(params);
            self.context = saved;
        }
        Some(params)
    }

    /// `is_at_element` for a parameter. `isStartOfParameter`: a private name starts one.
    #[inline(always)]
    fn is_at_parameter(&mut self) -> bool {
        !self.recovers()
            || self.token() == T::PrivateIdentifier
            || self.is_at_element(ListKind::Parameters)
    }

    /// `parseParameterEx`: pushes it on the stack of parameters, of which the list's start at
    /// `base`. False: it is none.
    fn parameter(&mut self, base: usize, outer_await: u32, ambiguity: Ambiguity) -> bool {
        const PROPERTY_MODIFIERS: Flags = Flags::PUBLIC
            .union(Flags::PRIVATE)
            .union(Flags::PROTECTED)
            .union(Flags::READONLY)
            .union(Flags::OVERRIDE);
        let start = self.start();
        let mut flags = Flags::empty();
        let mut has_modifiers = false;
        let token = self.token();
        if token.is_modifier() || token == T::At {
            // "Decorators are parsed in the outer [Await] context, the rest of the parameter is
            // parsed in the function's [Await] context."
            let first = self.s.modifiers.len();
            let saved = self.enter_context(outer_await, ctx::AWAIT);
            let seen = self.modifiers(ModifiersOf::Declaration);
            self.context = saved;
            let index = (self.s.params.len() - base) as u32;
            for modifier in first..self.s.modifiers.len() {
                if let ModifierKind::Decorator(decorator) = self.s.modifiers[modifier].kind {
                    self.s.decorators.push((index, decorator));
                }
            }
            // The checker reports the others, which are in the list.
            // `abstract` and `static` are still among the flags of the property
            // (`getDeclarationModifierFlagsFromSymbol`).
            flags |= seen & PROPERTY_MODIFIERS;
            if seen.intersects(PROPERTY_MODIFIERS) {
                flags |= Flags::PARAMETER_PROPERTY | seen & (Flags::ABSTRACT | Flags::STATIC);
            }
            // In a type all are.
            if self.has_context(ctx::TYPE) {
                flags |= seen;
            }
            if self.options.is_javascript {
                self.check_js_parameter_modifiers(first, start.pos);
            }
            let list = self.take_modifiers(first);
            if !list.is_empty() {
                has_modifiers = true;
                self.s.param_modifiers.push((index, list));
            }
        }
        let pat;
        let is_this = self.token() == T::This;
        if is_this {
            pat = self
                .f
                .pat(PatKind::Ident(known::this), self.lx.start, self.lx.end);
            self.next();
            // A decorator of `this` is an error of the parser.
            if token.is_modifier() || token == T::At {
                if self.recovers() {
                    return self.this_parameter_after_modifiers(base, start, pat, flags);
                }
                self.refuse(Refusal::Reported);
            }
        } else {
            if self.eat(T::DotDotDot) {
                flags |= Flags::REST;
            }
            // `isParameterNameStart`
            if ambiguity == Ambiguity::Refused
                && !self.is_binding_identifier()
                && !matches!(self.token(), T::OpenBracket | T::OpenBrace)
            {
                return false;
            }
            // `parseNameOfParameter`
            pat = match self.token() {
                T::PrivateIdentifier => self.missing_binding_identifier(18009),
                _ => self.identifier_or_pattern(),
            };
            // "to avoid this we'll advance cursor to the next token."
            if self.recovers()
                && !has_modifiers
                && self.token().is_modifier()
                && (self.f.pats.get(pat.idx())).is_some_and(|it| it.pos == it.end)
            {
                self.next();
            }
            if self.token() == T::Question {
                self.js_error((self.pos(), 0), 8009, b"?");
                self.question_of_parameter = self.pos();
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
        true
    }

    /// The rest of `parseParameterEx` after a `this` with modifiers, the last list of the file.
    #[cold]
    #[inline(never)]
    fn this_parameter_after_modifiers(
        &mut self,
        base: usize,
        start: Start,
        pat: PatId,
        mut flags: Flags,
    ) -> bool {
        let index = (self.s.params.len() - base) as u32;
        let list = match self.s.param_modifiers.last() {
            Some(&(param, list)) if param == index => list,
            _ => Span::EMPTY,
        };
        let modifiers = self.f.modifiers.get(list.range()).unwrap_or_default();
        // `modifiers.Nodes[0].Loc`
        let end_of_first = modifiers.first().and_then(|first| match first.kind {
            ModifierKind::Keyword(flag) => Some(first.pos + modifier_text(flag).len() as u32),
            ModifierKind::Decorator(e) => {
                (self.f.exprs.get(e.idx())).map(|_| end_of_expr(&self.f, e))
            }
        });
        // `GetThisParameter`: nothing asks for its modifiers, and `checkDecorators` passes it by.
        let strays = self.s.modifiers.len();
        if index == 0 && !list.is_empty() && !self.has_context(ctx::TYPE) {
            let is_decorator = |it: &&Modifier| matches!(it.kind, ModifierKind::Decorator(_));
            self.s
                .modifiers
                .extend(modifiers.iter().filter(is_decorator));
            let decorators = self.s.modifiers.len() - strays;
            let of_others = self.s.decorators.len().saturating_sub(decorators);
            self.s.decorators.truncate(of_others);
            self.s.param_modifiers.pop();
            self.f.modifiers.truncate(list.start as usize);
            flags = Flags::empty();
        }
        let ty = self.type_annotation();
        if let Some(end) = end_of_first {
            self.error(1433, (start.full, end), &[]);
        }
        if self.s.modifiers.len() > strays {
            let name_pos = self.f.pats.get(pat.idx()).map_or(start.pos, |it| it.pos);
            self.note_stray_decorators(strays, name_pos);
        }
        self.s.params.push(Param {
            pat,
            ty,
            default: ExprId::NONE,
            flags,
            pos: start.pos,
            loc: TextRange {
                pos: start.full,
                end: self.prev_end(),
            },
        });
        true
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
                return self.parenthesized_arrow_function(Tristate::True, true);
            }
            Tristate::Unknown => {
                // `parsePossibleParenthesizedArrowFunctionExpression`
                let at = self.pos();
                // What is before a token that is read for good is not read again.
                if self.speculations == 0 {
                    let read = self.not_arrows.partition_point(|&it| it < at);
                    self.not_arrows.drain(..read);
                }
                if self.not_arrows.binary_search(&at).is_err() {
                    let arrow = self.try_parse(|p| {
                        p.parenthesized_arrow_function(Tristate::Unknown, allow_return_type)
                    });
                    if arrow.is_some() {
                        return arrow;
                    }
                    let place = self.not_arrows.partition_point(|&it| it < at);
                    self.not_arrows.insert(place, at);
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
        self.next_after_name();
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
                // `(a: T)` can be a cast.
                T::Colon if self.is_flow => Tristate::Unknown,
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
            if !self.options.is_jsx || self.is_flow {
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

    /// `parseParenthesizedArrowFunctionExpression`. `is_one`: what the tokens ahead have said.
    /// `parseParenthesizedArrowFunctionExpression` at a `=>`: the `(` is missed.
    #[cold]
    #[inline(never)]
    pub(crate) fn arrow_function_without_parameters(
        &mut self,
        allow_return_type: bool,
    ) -> Option<ExprId> {
        self.parenthesized_arrow_function(Tristate::True, allow_return_type)
    }

    fn parenthesized_arrow_function(
        &mut self,
        is_one: Tristate,
        allow_return_type: bool,
    ) -> Option<ExprId> {
        let allow_ambiguity = is_one == Tristate::True;
        let start = self.pos();
        let mut flags = Flags::empty();
        if self.eat(T::Async) {
            flags |= Flags::ASYNC;
        }
        let type_params = self.type_parameters();
        let ambiguity = match allow_ambiguity {
            true => Ambiguity::Allowed,
            false => Ambiguity::Refused,
        };
        let (this_param, params) = self.parameters_if(signature_context(flags), ambiguity)?;
        let errors = self.f.diagnostics.len();
        let has_return_colon = self.token() == T::Colon;
        let ret = match has_return_colon {
            true if self.is_flow => {
                self.next();
                self.flow_return_type_of_arrow_function()
            }
            true => {
                self.next();
                self.type_or_type_predicate()
            }
            false => TypeNodeId::NONE,
        };
        if !allow_ambiguity
            && self.recovers()
            && self.f.diagnostics.len() > errors
            && self.has_arrow_function_blocking_parse_error(ret)
        {
            return None;
        }
        let last = self.token();
        if last != T::EqualsGreaterThan && !self.recovers() {
            // Before a `{` TypeScript takes it for an arrow function whose `=>` is missing.
            if last == T::OpenBrace && !self.has_failed() && !self.is_ecmascript {
                self.refuse(Refusal::Reported);
            }
            if allow_ambiguity {
                self.fail();
            }
            return None;
        }
        if !allow_ambiguity && !matches!(last, T::EqualsGreaterThan | T::OpenBrace) {
            return None;
        }
        let mut anchor = self.pos();
        if !self.expect(T::EqualsGreaterThan) {
            // `parseExpectedToken`: the missing token is at `nodePos()`.
            anchor = self.full_start();
        }
        let (body, open) = match last {
            T::EqualsGreaterThan | T::OpenBrace => {
                self.arrow_function_body(flags, allow_return_type)
            }
            // `parseIdentifier`
            _ if self.is_identifier() => {
                self.take_as_name();
                let name = self.note_identifier(self.lx.atom, self.lx.start);
                (FnBody::Expr(self.token_expr(ExprKind::Ident(name))), 0)
            }
            _ => (FnBody::Expr(self.missing_expression(0)), 0),
        };
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
        if self.reads_jsdoc() {
            self.function_jsdoc(func, start);
        }
        Some(self.finish_expr(ExprKind::Fn(func), start))
    }

    /// `typeHasArrowFunctionBlockingParseError`, of a type in which an error was reported.
    #[cold]
    fn has_arrow_function_blocking_parse_error(&self, mut ty: TypeNodeId) -> bool {
        loop {
            match self.f.types.get(ty.idx()).map(|it| it.kind) {
                Some(TypeNodeKind::Ref { name, .. }) => {
                    let first = self.f.names.get(name.start as usize);
                    return name.len == 1 && first.is_some_and(|it| it.text == known::empty);
                }
                Some(TypeNodeKind::Fn(func)) => {
                    let Some(func) = self.f.fns.get(func.idx()) else {
                        return false;
                    };
                    // `isMissingNodeList`: `anchor` is where `parseParameters` has started.
                    if self.lx.src.get(func.anchor as usize) != Some(&b'(') {
                        return true;
                    }
                    ty = func.ret;
                }
                _ => return false,
            }
        }
    }

    /// `parseArrowFunctionExpressionBody`: the body, and the position of its `{`.
    fn arrow_function_body(&mut self, flags: Flags, allow_return_type: bool) -> (FnBody, u32) {
        let context = signature_context(flags);
        if self.token() == T::OpenBrace {
            return self.function_block(context);
        }
        // It starts a statement and no expression statement: a block whose `{` is missing.
        if self.token() == T::At {
            self.fail_unless_recovering();
        }
        // `isStartOfExpressionStatement`
        if self.recovers()
            && !matches!(self.token(), T::Semicolon | T::Function | T::Class)
            && self.is_start_of_statement()
            && (self.token() == T::At || !self.is_start_of_expression())
        {
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
        if self.reads_jsdoc() {
            self.function_jsdoc(func, start);
        }
        self.finish_expr(ExprKind::Fn(func), start)
    }
}
