//! Functions: declarations, expressions, arrow functions, parameters.

use super::declared::Declares;
use super::stmt::{ModifiersOf, Start};
use super::{ListKind, Parser, ctx, oxc, take_span};
use crate::Rejection;
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
    /// Anything that isn't definitely a parameter list is rejected.
    Disallowed,
}

/// Returns the context bits for the parameters and body of a function with `flags`.
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

impl<const GENERAL: bool, const COMMENTS: bool> Parser<'_, GENERAL, COMMENTS> {
    /// `parseFunctionDeclaration`
    pub(crate) fn function_declaration(
        &mut self,
        start: Start,
        base: usize,
        flags: Flags,
    ) -> StmtId {
        // For `default function f() {}` without `export`, `default` is only recorded in the modifiers.
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
        } else if (self.token() == T::LessThan
            || self.token() == T::OpenParen && flags.contains(Flags::AMBIENT))
            && self.reports_like_oxc()
        {
            // `declare function ();`, `function <T>() {}`: oxc doesn't require a name there.
            (Atom::NONE, self.pos())
        } else if !flags.contains(Flags::DEFAULT) {
            let full = self.full_start();
            match self.missing_identifier(0, 0) {
                (known::empty, _) => (known::empty, full),
                name => name,
            }
        } else {
            // An unnamed default export is positioned at `export`.
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
        if name.is_some() {
            self.declare(name, Declares::Function);
        }
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
        // Its name is parsed in its body's context.
        let cleared = ctx::YIELD | ctx::AWAIT | ctx::TOP_LEVEL;
        let saved = self.enter_context(signature_context(flags), cleared);
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

    /// Parses a function from its type parameters to the end of its body.
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
        self.function_rest_with_error_code(code, kind, flags, (name, name_pos), start)
    }

    /// Like `function_rest`. `code` is the error reported at a token that's neither the body's `{` nor a `;` in its
    /// place.
    pub(crate) fn function_rest_with_error_code(
        &mut self,
        code: u32,
        kind: FnKind,
        mut flags: Flags,
        (name, name_pos): (Atom, u32),
        start: u32,
    ) -> FnId {
        // In oxc, `await` and `yield` inside a type mean what they mean around the type. So for oxc the type parameters
        // and the return type are parsed in the function's context.
        let outer = self.context;
        if self.options.dialect.oxc {
            let cleared = ctx::YIELD | ctx::AWAIT | ctx::TOP_LEVEL;
            self.context = outer & !cleared | signature_context(flags);
        }
        let type_params = self.type_parameters();
        let anchor = match self.token() {
            T::OpenParen => self.pos(),
            // `createMissingList`
            _ => self.full_start().saturating_sub(1),
        };
        let odd_parameters = self.odd_parameters;
        let (this_param, params) = self.parameters(signature_context(flags));
        let parameters = (odd_parameters, this_param);
        self.note_odd_accessor_parameters(kind, params);
        let ret = match self.token() {
            T::Colon => {
                self.next();
                self.type_or_type_predicate()
            }
            _ => TypeNodeId::NONE,
        };
        self.context = outer;
        // `parseFunctionBlockOrSemicolon`
        let (body, open) = match self.token() {
            T::OpenBrace => {
                self.note_parameters(type_params, params);
                self.function_block(signature_context(flags))
            }
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
                // Flow only allows a function without a body in an ambient context.
                if self.is_flow() && !self.has_context(ctx::AMBIENT) {
                    self.fail();
                }
                self.semicolon();
                (FnBody::None, 0)
            }
        };
        // Without a body, the whole function is reported instead.
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
        if self.is_odd_function((kind, flags), parameters, &body) {
            self.check_function_like_oxc(func, open);
        }
        func
    }

    /// `parseFunctionBlock`, at the `{`. Returns the body and the position of the `{`.
    pub(crate) fn function_block(&mut self, context: u32) -> (FnBody, u32) {
        let open = self.pos();
        let cleared = ctx::YIELD | ctx::AWAIT | ctx::TOP_LEVEL | ctx::DECORATOR | ctx::CLASS_MEMBER;
        let cleared = cleared | ctx::IN_LOOP | ctx::IN_SWITCH | ctx::OUTSIDE_BODIES;
        let cleared = cleared | self.disallow_in_if_cleared_by_brackets();
        let saved = self.enter_context(context, cleared);
        let had_await_identifier = self.has_await_identifier;
        // `None` only for a block that recovery parses without its `{`.
        let open_at = self.expect(T::OpenBrace).then_some(open);
        if self.token() == T::String {
            self.f.rare_syntax |= rare::DIRECTIVE_IN_FUNCTION;
        }
        self.open_function();
        let list = self.statements_until_close_brace();
        self.close_scope();
        self.context = saved;
        self.has_await_identifier = had_await_identifier;
        self.expect_matching((T::OpenBrace, T::CloseBrace), open_at);
        if self.token() == T::Equals {
            self.equals_after_block();
        }
        (FnBody::Block(list), open)
    }

    // ───────────────────────────── parameters ─────────────────────────────

    /// `checkGrammarTypeParameterList`, for a list from `less_than` to the current token that has no parameters but
    /// isn't literally `<>`. The checker finds `<>` in the text.
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
        if self.is_flow() {
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
                true => {
                    self.f.rare_syntax |= rare::TYPE_PARAMETER_MODIFIER;
                    self.modifiers(ModifiersOf::TypeParameter)
                }
                false => Flags::empty(),
            };
            // The checker reports the other modifiers from the modifier list.
            let flags = flags & (Flags::IN | Flags::OUT | Flags::CONST);
            let (name, pos, start) = if self.is_identifier() {
                if self.token() != T::Identifier && self.reports_like_oxc() {
                    self.check_type_name_like_oxc(oxc::TypeName::TypeParameter);
                }
                let (name, pos) = (self.lx.atom, self.pos());
                self.note_identifier(name, pos);
                self.next_after_name();
                (name, pos, start)
            } else {
                self.missing_name_of_type_parameter(start)
            };
            let constraint = match self.eat(T::Extends) {
                true if !self.is_start_of_type() && self.is_start_of_expression() => {
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
            if !self.eat(T::Comma)
                && !self.continues_without_comma(ListKind::TypeParameters, element)
            {
                break;
            }
        }
        self.leave_list(lists);
        if self.recovers() && self.s.type_params.len() == base {
            self.empty_type_parameters(less_than);
        }
        if self.s.type_params.len() == base
            && self.token() == T::GreaterThan
            && self.reports_like_oxc()
        {
            let list = (less_than, self.lx.end);
            oxc::empty_type_parameters(&mut self.f.diagnostics, list);
        }
        if self.options.is_javascript
            && let [first, .., last] | [first @ last] = self.s.type_params[base..]
        {
            self.js_error((first.start, last.end), 8004, b"");
        } else if self.is_ecmascript {
            match self.is_for_oxc() {
                // As with a non-empty list, the error is at whatever follows the `<`.
                true => self.js_error((less_than + 1, Diagnostic::NO_LENGTH), 8004, b""),
                false => self.report(),
            }
        }
        self.expect(T::GreaterThan);
        take_span!(self, type_params, base)
    }

    /// `parseIdentifier` in `parseTypeParameter`, at a token that isn't an identifier. Returns the name, its position
    /// and the new `start`.
    #[cold]
    #[inline(never)]
    fn missing_name_of_type_parameter(&mut self, start: u32) -> (Atom, u32, u32) {
        let (full, token) = (self.full_start(), self.pos());
        match self.missing_identifier(0, 0) {
            // Without modifiers the type parameter consists only of the name, at `nodePos()`.
            (known::empty, _) if start == token => (known::empty, full, full),
            (known::empty, _) => (known::empty, full, start),
            (name, pos) => (name, pos, start),
        }
    }

    /// `parseUnaryExpressionOrHigher` in `parseTypeParameter`: the tree has nowhere to store the expression, so it's
    /// discarded.
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
        self.discard_nodes(&before);
    }

    /// `parseParameters`, at the `(`. Returns the `this` parameter and the other parameters. `context` is the
    /// function's context.
    pub(crate) fn parameters(&mut self, context: u32) -> (ParamId, Span<ParamId>) {
        self.parameters_if(context, Ambiguity::Allowed)
            .unwrap_or((ParamId::NONE, Span::EMPTY))
    }

    /// Like `parameters`, with the ambiguity handling of `parseParenthesizedArrowFunctionExpression`.
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
        if !self.expect(T::CloseParen) && ambiguity == Ambiguity::Disallowed {
            return None;
        }
        // `GetThisParameter`: the first parameter, if it's named `this`.
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

    /// Sets `rare::ODD_ACCESSOR`. Call after parsing a function's parameters.
    #[inline]
    pub(crate) fn note_odd_accessor_parameters(&mut self, kind: FnKind, params: Span<ParamId>) {
        let first = self.f.params.get(params.start as usize);
        let is_odd = match kind {
            FnKind::Getter => !params.is_empty(),
            FnKind::Setter => {
                params.len != 1 || first.is_some_and(|it| it.flags.contains(Flags::REST))
            }
            _ => false,
        };
        if is_odd {
            self.f.rare_syntax |= rare::ODD_ACCESSOR;
        }
    }

    /// `parseParametersWorker`
    pub(crate) fn parameter_list(&mut self, context: u32, close: T) -> Span<ParamId> {
        self.parameter_list_if(context, close, Ambiguity::Allowed)
            .unwrap_or(Span::EMPTY)
    }

    /// Sets `hir::File::may_bind_a_parameter_twice`. Call after parsing two or more parameters, which are on the stack
    /// from `base` on.
    #[inline]
    fn note_duplicate_parameter_names(&mut self, base: usize) {
        let (pats, params) = (&self.f.pats, self.s.params.get(base..).unwrap_or_default());
        let name_of = |it: &Param| match pats.get(it.pat.idx()) {
            Some(&Pat {
                kind: PatKind::Ident(name),
                ..
            }) => name,
            // Names bound by a pattern aren't checked here.
            _ => Atom::NONE,
        };
        // Don't compare all pairs in a long list.
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

    /// `parseParametersWorker`. Returns `None` if this isn't a parameter list. The speculative parse in progress then
    /// rolls back what was built.
    fn parameter_list_if(
        &mut self,
        context: u32,
        close: T,
        ambiguity: Ambiguity,
    ) -> Option<Span<ParamId>> {
        let outer_await = self.context & ctx::AWAIT;
        // oxc parses the parameters of a signature inside a type in the context around the type. At the top level, an
        // `await` there is treated like one outside the type.
        let cleared = match self.has_context(ctx::TYPE) {
            true if self.options.dialect.oxc => self.cleared_in_types,
            true => self.cleared_in_types | ctx::TOP_LEVEL,
            false => ctx::YIELD | ctx::AWAIT | ctx::TOP_LEVEL,
        };
        let cleared = cleared | self.disallow_in_if_cleared_by_brackets();
        let saved = self.enter_context(context, cleared);
        let suspensions = self.suspensions;
        let base = self.s.params.len();
        let modifiers = self.s.param_modifiers.len();
        let decorators = self.s.decorators.len();
        let lists = self.enter_list(ListKind::Parameters);
        while self.is_in_list(close) && self.is_at_parameter() {
            let element = self.full_start();
            if !self.parameter(base, outer_await, ambiguity) {
                return None;
            }
            if !self.eat(T::Comma) && !self.continues_without_comma(ListKind::Parameters, element) {
                break;
            }
        }
        self.leave_list(lists);
        self.context = saved;
        if self.suspensions != suspensions {
            self.f.rare_syntax |= rare::SUSPENDS_IN_PARAMETERS;
        }
        if self.s.params.len() > base + 1 {
            self.note_duplicate_parameter_names(base);
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
            // `withJSDoc` for a parameter runs in the list's context.
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

    /// `parseParameterEx`: pushes the parameter on the parameter stack, where the list's parameters start at `base`.
    /// Returns false if this isn't a parameter.
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
            let modifier_flags = self.modifiers(ModifiersOf::Declaration);
            self.context = saved;
            let index = (self.s.params.len() - base) as u32;
            for modifier in first..self.s.modifiers.len() {
                if let ModifierKind::Decorator(decorator) = self.s.modifiers[modifier].kind {
                    self.s.decorators.push((index, decorator));
                }
            }
            // The checker reports the other modifiers from the modifier list. `abstract` and `static` still count as
            // flags of the property (`getDeclarationModifierFlagsFromSymbol`).
            flags |= modifier_flags & PROPERTY_MODIFIERS;
            if modifier_flags.intersects(PROPERTY_MODIFIERS) {
                flags |=
                    Flags::PARAMETER_PROPERTY | modifier_flags & (Flags::ABSTRACT | Flags::STATIC);
            }
            // In a type, every modifier is kept as a flag.
            if self.has_context(ctx::TYPE) {
                flags |= modifier_flags;
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
            if self.s.params.len() > base && self.reports_like_oxc() {
                oxc::this_after_parameter(&mut self.f.diagnostics, self.lx.start);
            }
            self.next();
            // A modifier or decorator on `this` is a parse error.
            if token.is_modifier() || token == T::At {
                if self.recovers() {
                    return self.this_parameter_after_modifiers(base, start, pat, flags);
                }
                self.reject(Rejection::Reported);
            }
        } else {
            if self.eat(T::DotDotDot) {
                flags |= Flags::REST;
            }
            // `isParameterNameStart`
            if ambiguity == Ambiguity::Disallowed
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
                self.parameter_question_pos = self.pos();
                self.next();
                flags |= Flags::OPTIONAL;
            }
        }
        if !flags.is_empty() || has_modifiers {
            self.odd_parameters = self.odd_parameters.wrapping_add(1);
        }
        let ty = self.type_annotation();
        // `this` has no initializer.
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

    /// The rest of `parseParameterEx` after a `this` with modifiers. Those modifiers are the file's last modifier list.
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
        // `GetThisParameter`: nothing reads its modifiers, and `checkDecorators` skips it.
        let strays = self.s.modifiers.len();
        if index == 0 && !list.is_empty() && !self.has_context(ctx::TYPE) {
            let is_decorator = |it: &&Modifier| matches!(it.kind, ModifierKind::Decorator(_));
            self.s
                .modifiers
                .extend(modifiers.iter().filter(is_decorator));
            let decorators = self.s.modifiers.len() - strays;
            let others_len = self.s.decorators.len().saturating_sub(decorators);
            self.s.decorators.truncate(others_len);
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

    /// `checkJSSyntax` for the modifiers of the parameter that starts at `start`, which are on the stack from `first`
    /// on. Reports `node.Modifiers().Loc` if a keyword is among them.
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
        // For `() =>`, checking the text gives the same answer as scanning the tokens.
        let arrow_lookahead = match self.token() == T::OpenParen && self.is_followed_by(b") =>") {
            true => Tristate::True,
            false => self.look_ahead(Self::is_parenthesized_arrow_function),
        };
        match arrow_lookahead {
            Tristate::True => {
                return self.parenthesized_arrow_function(Tristate::True, true);
            }
            Tristate::Unknown => {
                // `parsePossibleParenthesizedArrowFunctionExpression`
                let at = self.pos();
                // Outside a speculation the parser never goes back, so earlier positions can be dropped.
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
                    let insert_at = self.not_arrows.partition_point(|&it| it < at);
                    self.not_arrows.insert(insert_at, at);
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
            // oxc accepts the arrow function and reports the line break.
            p.token() == T::EqualsGreaterThan && (!p.newline_before() || p.options.dialect.oxc)
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
                    p.is_name_of_first_parameter()
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
            if !self.is_name_of_first_parameter() && second != T::This {
                return Tristate::False;
            }
            self.next();
            match self.token() {
                // `(a: T)` can be a cast.
                T::Colon if self.is_flow() => Tristate::Unknown,
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
            if !self.options.is_jsx || self.is_flow() {
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

    /// `isIdentifier`, after the `(` that may start an arrow function. TypeScript first parses a top-level statement of
    /// a module outside the await context, where `(await) => {}` is an arrow function. A parameter name doesn't trigger
    /// a reparse of the statement. See `top_level_statement`.
    fn is_name_of_first_parameter(&mut self) -> bool {
        if self.token() == T::Await
            && self.has_context(ctx::AWAIT)
            && self.await_context_of_module() != 0
        {
            self.has_await_in_name = true;
            return true;
        }
        self.is_identifier()
    }

    /// `parseParenthesizedArrowFunctionExpression` at a `=>`: the `(` is missing.
    #[cold]
    #[inline(never)]
    pub(crate) fn arrow_function_without_parameters(
        &mut self,
        allow_return_type: bool,
    ) -> Option<ExprId> {
        self.parenthesized_arrow_function(Tristate::True, allow_return_type)
    }

    /// `parseParenthesizedArrowFunctionExpression`. `arrow_lookahead` is the result of the lookahead.
    fn parenthesized_arrow_function(
        &mut self,
        arrow_lookahead: Tristate,
        allow_return_type: bool,
    ) -> Option<ExprId> {
        let allow_ambiguity = arrow_lookahead == Tristate::True;
        let start = self.pos();
        let mut flags = Flags::empty();
        if self.eat(T::Async) {
            flags |= Flags::ASYNC;
        }
        // For oxc, an `async` arrow function's type parameters and return type are parsed in its context, as in
        // `function_rest_with_error_code`.
        let type_context = match self.options.dialect.oxc && flags.contains(Flags::ASYNC) {
            true => (ctx::AWAIT, ctx::TOP_LEVEL),
            false => (0, 0),
        };
        let saved = self.enter_context(type_context.0, type_context.1);
        let type_params = self.type_parameters();
        self.context = saved;
        let ambiguity = match allow_ambiguity {
            true => Ambiguity::Allowed,
            false => Ambiguity::Disallowed,
        };
        // oxc first parses the parameters as an expression, in the context around the arrow function.
        let outer_context = match self.options.dialect.oxc {
            true => self.context & (ctx::YIELD | ctx::AWAIT | ctx::TOP_LEVEL),
            false => 0,
        };
        let context = signature_context(flags) | outer_context;
        let odd_parameters = self.odd_parameters;
        let (this_param, params) = self.parameters_if(context, ambiguity)?;
        let parameters = (odd_parameters, this_param);
        let errors = self.f.diagnostics.len();
        let has_return_colon = self.token() == T::Colon;
        let ret = match has_return_colon {
            true if self.is_flow() => {
                self.next();
                self.flow_return_type_of_arrow_function()
            }
            true => {
                self.next();
                let saved = self.enter_context(type_context.0, type_context.1);
                let ret = self.type_or_type_predicate();
                self.context = saved;
                ret
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
        if last == T::EqualsGreaterThan && self.newline_before() && self.is_for_oxc() {
            oxc::arrow_after_line_break(&mut self.f.diagnostics, self.lx.start);
        }
        if last != T::EqualsGreaterThan && !self.recovers() {
            // Before a `{`, TypeScript treats it as an arrow function whose `=>` is missing.
            if last == T::OpenBrace && !self.has_failed() && !self.is_ecmascript {
                self.reject(Rejection::Reported);
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
                if self.token() == T::OpenBrace {
                    self.note_parameters(type_params, params);
                }
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
        if self.is_odd_function((FnKind::Arrow, flags), parameters, &body) {
            self.check_function_like_oxc(func, open);
        }
        if self.reads_jsdoc() {
            self.function_jsdoc(func, start);
        }
        Some(self.finish_expr(ExprKind::Fn(func), start))
    }

    /// `typeHasArrowFunctionBlockingParseError`, for a type in which an error was reported.
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
                    // `isMissingNodeList`: `anchor` is where `parseParameters` started.
                    if self.lx.src.get(func.anchor as usize) != Some(&b'(') {
                        return true;
                    }
                    ty = func.ret;
                }
                _ => return false,
            }
        }
    }

    /// `parseArrowFunctionExpressionBody`. Returns the body and the position of its `{`.
    fn arrow_function_body(&mut self, flags: Flags, allow_return_type: bool) -> (FnBody, u32) {
        let context = signature_context(flags);
        if self.token() == T::OpenBrace {
            return self.function_block(context);
        }
        // `@` starts a statement that isn't an expression statement, so this is a block whose `{` is missing.
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
        let cleared = ctx::YIELD | ctx::AWAIT | ctx::TOP_LEVEL | ctx::OUTSIDE_BODIES;
        let saved = self.enter_context(context, cleared);
        let body = self.assignment_expression_or_higher(allow_return_type);
        self.context = saved;
        (FnBody::Expr(body), 0)
    }

    /// `parseSimpleArrowFunctionExpression`, at the `=>`. `name` is the parameter's name, followed by its start, end
    /// and full start.
    pub(crate) fn simple_arrow_function(
        &mut self,
        name: Atom,
        (pos, end, full): (u32, u32, u32),
        is_async: bool,
        start: u32,
        allow_return_type: bool,
    ) -> ExprId {
        let pat = self.add_pat(PatKind::Ident(name), pos, end);
        let param = self.f.add_param(Param {
            pat,
            ty: TypeNodeId::NONE,
            default: ExprId::NONE,
            flags: Flags::empty(),
            pos,
            loc: TextRange { pos: full, end },
        });
        let anchor = self.pos();
        if self.newline_before() && self.is_for_oxc() {
            oxc::arrow_after_line_break(&mut self.f.diagnostics, anchor);
        }
        self.next();
        let flags = match is_async {
            true => Flags::ASYNC,
            false => Flags::empty(),
        };
        if self.token() == T::OpenBrace {
            self.note_parameters(Span::EMPTY, Span::new(param.0, 1));
        }
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
