#!/usr/bin/env python3
"""Patches a COPY of src/js_parser (e3566be889) with a prototype of the erased parse of expressions inside type syntax.
usage: prototype-patch.py <directory of a fresh copy of src/js_parser>
The prototype is for compile checks and for comparing the code of the Discard and DecoratorMetadata grammar with
build-sink-positions/quick/run.py and scmp.py. It is not the implementation: it keeps the grammar of today and adds
only the cold hooks at the points where today's grammar reports an error."""
import sys
d = sys.argv[1]


def rep(s, old, new, count=1):
    assert s.count(old) >= count, (old[:80], s.count(old))
    return s.replace(old, new, count)


# ------------------------------------------------------------------ p.rs
p = d + '/p.rs'
s = open(p).read()
s = rep(s, '''pub(crate) type NeedsJSXType = bool;''', '''/// What an expression inside type syntax is read as.
#[derive(Clone, Copy)]
pub(crate) enum TypeExpr {
    /// `[expr]` as a property name: a comma expression, `in` allowed.
    ComputedName,
    /// `= expr` after a parameter or a property signature.
    Initializer,
    /// `= expr` inside a binding pattern: `in` allowed.
    PatternInitializer,
    /// The constraint of a type parameter that does not start a type.
    Constraint,
    /// The operand of a "-" that no number follows.
    MinusOperand,
    /// The value of an import attribute.
    AttributeValue,
    /// An entry of `extends` of an interface or of `implements`.
    Heritage,
}

/// See [`P::begin_erased_parse`].
pub(crate) struct ErasedParse<'a> {
    comments_to_preserve_before: Vec<js_ast::G::Comment>,
    log_msgs_len: usize,
    log_errors: u32,
    log_warnings: u32,
    log_was_disabled: bool,
    prev_error_loc: bun_ast::Loc,
    has_react_hooks_suppression_before: bool,
    allow_in: bool,
    allow_private_identifiers: bool,
    has_classic_runtime_warned: bool,
    has_non_local_export_declare_inside_namespace: bool,
    should_fold_typescript_constant_expressions: bool,
    has_import_meta: bool,
    has_with_scope: bool,
    has_es_module_syntax: bool,
    needs_jsx_import: bool,
    fn_or_arrow_data_parse: FnOrArrowDataParse,
    latest_arrow_arg_loc: bun_ast::Loc,
    forbid_suffix_after_as_loc: bun_ast::Loc,
    after_arrow_body_loc: bun_ast::Loc,
    esm_import_keyword: bun_ast::Range,
    esm_export_keyword: bun_ast::Range,
    enclosing_class_keyword: bun_ast::Range,
    top_level_await_keyword: bun_ast::Range,
    current_scope: js_ast::StoreRef<Scope>,
    current_scope_children_len: usize,
    scopes_in_order_len: usize,
    scopes_in_order_for_enum_len: usize,
    import_records_len: usize,
    parse_pass_symbol_uses: ParsePassSymbolUsageType<'a>,
}

pub(crate) type NeedsJSXType = bool;''')

s = rep(s, '''    /// When not transpiling we dont use the renamer, so our solution is to generate really
    /// hard to collide with variables, instead of actually making things collision free
    pub(crate) fn generate_temp_ref(''', '''    /// Starts the parse of an expression, a decorator list or a function body that sits inside type syntax.
    #[cold]
    #[inline(never)]
    pub(crate) fn begin_erased_parse(&mut self) -> ErasedParse<'a> {
        let comments_to_preserve_before =
            core::mem::take(&mut self.lexer.comments_to_preserve_before);
        let log_was_disabled = self.lexer.is_log_disabled;
        // With the log off a missing operand is accepted without a word: the count of errors decides instead.
        self.lexer.is_log_disabled = false;
        let log = self.log();
        let frame = ErasedParse {
            comments_to_preserve_before,
            log_msgs_len: log.msgs.len(),
            log_errors: log.errors,
            log_warnings: log.warnings,
            log_was_disabled,
            prev_error_loc: self.lexer.prev_error_loc,
            has_react_hooks_suppression_before: self.lexer.has_react_hooks_suppression_before,
            allow_in: self.allow_in,
            allow_private_identifiers: self.allow_private_identifiers,
            has_classic_runtime_warned: self.has_classic_runtime_warned,
            has_non_local_export_declare_inside_namespace: self
                .has_non_local_export_declare_inside_namespace,
            should_fold_typescript_constant_expressions: self
                .should_fold_typescript_constant_expressions,
            has_import_meta: self.has_import_meta,
            has_with_scope: self.has_with_scope,
            has_es_module_syntax: self.has_es_module_syntax,
            needs_jsx_import: self.needs_jsx_import,
            fn_or_arrow_data_parse: self.fn_or_arrow_data_parse.clone(),
            latest_arrow_arg_loc: self.latest_arrow_arg_loc,
            forbid_suffix_after_as_loc: self.forbid_suffix_after_as_loc,
            after_arrow_body_loc: self.after_arrow_body_loc,
            esm_import_keyword: self.esm_import_keyword,
            esm_export_keyword: self.esm_export_keyword,
            enclosing_class_keyword: self.enclosing_class_keyword,
            top_level_await_keyword: self.top_level_await_keyword,
            current_scope: self.current_scope,
            current_scope_children_len: self.current_scope.children.len(),
            scopes_in_order_len: self.scopes_in_order.len(),
            scopes_in_order_for_enum_len: self.scopes_in_order_for_enum.len(),
            import_records_len: self.import_records.len(),
            // A name inside dropped code is not a use of an import.
            parse_pass_symbol_uses: self.parse_pass_symbol_uses.take(),
        };
        // The reference reads `super` and private names anywhere and leaves the complaint to its checker.
        self.fn_or_arrow_data_parse.allow_super_call = true;
        self.fn_or_arrow_data_parse.allow_super_property = true;
        self.allow_private_identifiers = true;
        frame
    }

    /// Ends it, after success and after failure: the scopes it pushed are dropped and the flags read as before.
    /// The lexer stays where the parse left it, and symbols stay, so every `Ref` in what was parsed still loads.
    #[cold]
    #[inline(never)]
    pub(crate) fn end_erased_parse<R>(
        &mut self,
        frame: ErasedParse<'a>,
        result: Result<R, crate::Error>,
    ) -> Result<R, crate::Error> {
        self.lexer.comments_to_preserve_before = frame.comments_to_preserve_before;
        self.lexer.has_react_hooks_suppression_before = frame.has_react_hooks_suppression_before;
        self.lexer.is_log_disabled = frame.log_was_disabled;

        let mut failed_in_speculation = false;
        if frame.log_was_disabled {
            // Inside speculation nothing may stay in the log, and an error of the dropped code fails the attempt.
            let log = self.log();
            failed_in_speculation = log.errors != frame.log_errors;
            log.msgs.truncate(frame.log_msgs_len);
            log.errors = frame.log_errors;
            log.warnings = frame.log_warnings;
            self.lexer.prev_error_loc = frame.prev_error_loc;
        }

        self.allow_in = frame.allow_in;
        self.allow_private_identifiers = frame.allow_private_identifiers;
        self.has_classic_runtime_warned = frame.has_classic_runtime_warned;
        self.has_non_local_export_declare_inside_namespace =
            frame.has_non_local_export_declare_inside_namespace;
        self.should_fold_typescript_constant_expressions =
            frame.should_fold_typescript_constant_expressions;
        self.has_import_meta = frame.has_import_meta;
        self.has_with_scope = frame.has_with_scope;
        self.has_es_module_syntax = frame.has_es_module_syntax;
        self.needs_jsx_import = frame.needs_jsx_import;
        self.fn_or_arrow_data_parse = frame.fn_or_arrow_data_parse;
        self.latest_arrow_arg_loc = frame.latest_arrow_arg_loc;
        self.forbid_suffix_after_as_loc = frame.forbid_suffix_after_as_loc;
        self.after_arrow_body_loc = frame.after_arrow_body_loc;
        self.esm_import_keyword = frame.esm_import_keyword;
        self.esm_export_keyword = frame.esm_export_keyword;
        self.enclosing_class_keyword = frame.enclosing_class_keyword;
        self.top_level_await_keyword = frame.top_level_await_keyword;

        // Every scope pushed since is a descendant of the then-current scope.
        let mut scope = frame.current_scope;
        scope.children.truncate(frame.current_scope_children_len);
        self.current_scope = scope;
        self.scopes_in_order.truncate(frame.scopes_in_order_len);
        while self.scopes_in_order_for_enum.len() > frame.scopes_in_order_for_enum_len {
            self.scopes_in_order_for_enum.pop();
        }
        self.import_records.truncate(frame.import_records_len);
        self.parse_pass_symbol_uses = frame.parse_pass_symbol_uses;

        match result {
            Ok(_) if failed_in_speculation => Err(crate::Error::Backtrack),
            other => other,
        }
    }

    /// An expression inside type syntax. Only a sink that builds nodes keeps the value.
    #[cold]
    #[inline(never)]
    pub(crate) fn parse_expr_in_type(&mut self, kind: TypeExpr) -> Result<Expr, crate::Error> {
        use bun_ast::op::Level;
        let frame = self.begin_erased_parse();
        let result = match kind {
            TypeExpr::ComputedName => {
                self.allow_in = true;
                self.parse_expr(Level::Lowest)
            }
            TypeExpr::Initializer | TypeExpr::AttributeValue => self.parse_expr(Level::Comma),
            TypeExpr::PatternInitializer => {
                self.allow_in = true;
                self.parse_expr(Level::Comma)
            }
            TypeExpr::Constraint => self.parse_expr(Level::Multiply),
            TypeExpr::MinusOperand => self.parse_expr(Level::Prefix),
            TypeExpr::Heritage => self.parse_expr(Level::New),
        };
        self.end_erased_parse(frame, result)
    }

    /// The decorators of a parameter of a signature.
    #[cold]
    #[inline(never)]
    pub(crate) fn parse_decorators_in_type(&mut self) -> Result<ExprNodeList, crate::Error> {
        let frame = self.begin_erased_parse();
        let result = self.parse_type_script_decorators();
        self.end_erased_parse(frame, result)
    }

    /// The body of an accessor of a type literal or of an interface, at its "{".
    #[cold]
    #[inline(never)]
    pub(crate) fn parse_fn_body_in_type(&mut self) -> Result<G::FnBody, crate::Error> {
        let frame = self.begin_erased_parse();
        let result = self.parse_fn_body_in_type_inner();
        self.end_erased_parse(frame, result)
    }

    fn parse_fn_body_in_type_inner(&mut self) -> Result<G::FnBody, crate::Error> {
        // The scope of the arguments must start before the scope of the body.
        let args_loc = bun_ast::Loc {
            start: self.lexer.loc().start - 1,
        };
        let _ = self.push_scope_for_parse_pass(js_ast::scope::Kind::FunctionArgs, args_loc)?;
        let mut data = FnOrArrowDataParse {
            allow_super_call: true,
            allow_super_property: true,
            ..Default::default()
        };
        let body = self.parse_fn_body(&mut data)?;
        self.pop_scope();
        Ok(body)
    }

    /// When not transpiling we dont use the renamer, so our solution is to generate really
    /// hard to collide with variables, instead of actually making things collision free
    pub(crate) fn generate_temp_ref(''')
open(p, 'w').write(s)

# ------------------------------------------------------------------ typescript.rs
p = d + '/typescript.rs'
s = open(p).read()
s = rep(s, '''    fn is_start_of_expression(&mut self) -> bool {''', '''    pub(crate) fn is_start_of_expression(&mut self) -> bool {''')
s = rep(s, '''    AllowTupleLabels,
    DisallowConditionalTypes,
}''', '''    AllowTupleLabels,
    DisallowConditionalTypes,
    /// The first token is the first token of the constraint of a type parameter.
    ConstraintStart,
}''')
open(p, 'w').write(s)

# ------------------------------------------------------------------ parse_skip_typescript.rs
p = d + '/parse/parse_skip_typescript.rs'
s = open(p).read()
s = rep(s, '''use crate::p::P;
''', '''use crate::p::{P, TypeExpr};
''')

# --- parameters of a signature: the initializer hangs on the branch that reports a missing ")" today
s = rep(s, '''        self.lexer.expect(T::TOpenParen)?;

        while self.lexer.token != T::TCloseParen {
            // "(...a)"
            if self.lexer.token == T::TDotDotDot {
                self.lexer.next()?;
            }

            self.skip_type_script_binding()?;

            // "(a?)"
            if self.lexer.token == T::TQuestion {
                self.lexer.next()?;
            }

            // "(a: any)"
            if self.lexer.token == T::TColon {
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
            }

            // "(a, b)"
            if self.lexer.token != T::TComma {
                break;
            }

            self.lexer.next()?;
        }

        self.lexer.expect(T::TCloseParen)?;
        Ok(())
    }
''', '''        self.lexer.expect(T::TOpenParen)?;

        loop {
            while self.lexer.token != T::TCloseParen {
                // "(...a)"
                if self.lexer.token == T::TDotDotDot {
                    self.lexer.next()?;
                }

                self.skip_type_script_binding_at::<true>()?;

                // "(a?)"
                if self.lexer.token == T::TQuestion {
                    self.lexer.next()?;
                }

                // "(a: any)"
                if self.lexer.token == T::TColon {
                    self.lexer.next()?;
                    self.skip_type_script_type(Level::Lowest)?;
                }

                // "(a, b)"
                if self.lexer.token != T::TComma {
                    break;
                }

                self.lexer.next()?;
            }

            if self.lexer.token == T::TCloseParen {
                self.lexer.next()?;
                return Ok(());
            }
            // "(a = 1)"
            if !self.skip_initializer_in_type(TypeExpr::Initializer)? {
                self.lexer.expect(T::TCloseParen)?;
                return Ok(());
            }
        }
    }

    /// At a token that ends neither an element nor its list. True when it was "=" and its expression was read.
    #[cold]
    #[inline(never)]
    fn skip_initializer_in_type(&mut self, kind: TypeExpr) -> Result<bool, Error> {
        if self.lexer.token != T::TEquals || self.lexer.is_log_disabled {
            return Ok(false);
        }
        self.lexer.next()?;
        let _ = self.parse_expr_in_type(kind)?;
        if self.lexer.token == T::TComma {
            self.lexer.next()?;
        }
        Ok(true)
    }

    /// At a token that starts no binding. True when decorators were read or a computed name was read.
    #[cold]
    #[inline(never)]
    fn skip_binding_start_in_type(&mut self, top: bool) -> Result<bool, Error> {
        if self.lexer.is_log_disabled {
            return Ok(false);
        }
        if top && self.lexer.token == T::TAt {
            let _ = self.parse_decorators_in_type()?;
            return Ok(true);
        }
        if !top && self.lexer.token == T::TOpenBracket {
            self.lexer.next()?;
            let _ = self.parse_expr_in_type(TypeExpr::ComputedName)?;
            self.lexer.expect(T::TCloseBracket)?;
            return Ok(true);
        }
        Ok(false)
    }
''')

s = rep(s, '''    pub(crate) fn skip_type_script_binding(&mut self) -> Result<(), Error> {
        self.mark_type_script_only();''', '''    #[inline]
    pub(crate) fn skip_type_script_binding(&mut self) -> Result<(), Error> {
        self.skip_type_script_binding_at::<false>()
    }

    /// `TOP` is true for the name of a parameter, which decorators may precede.
    pub(crate) fn skip_type_script_binding_at<const TOP: bool>(&mut self) -> Result<(), Error> {
        self.mark_type_script_only();''')

# array pattern: the initializer hangs on the branch that reports a missing "]" today
s = rep(s, '''                // "[a, b]"
                while self.lexer.token != T::TCloseBracket {
                    // "[...a]"
                    if self.lexer.token == T::TDotDotDot {
                        self.lexer.next()?;
                    }

                    self.skip_type_script_binding()?;

                    if self.lexer.token != T::TComma {
                        break;
                    }
                    self.lexer.next()?;
                }

                self.lexer.expect(T::TCloseBracket)?;
            }''', '''                // "[a, b]"
                loop {
                    while self.lexer.token != T::TCloseBracket {
                        // "[...a]"
                        if self.lexer.token == T::TDotDotDot {
                            self.lexer.next()?;
                        }

                        self.skip_type_script_binding()?;

                        if self.lexer.token != T::TComma {
                            break;
                        }
                        self.lexer.next()?;
                    }

                    if self.lexer.token == T::TCloseBracket {
                        self.lexer.next()?;
                        break;
                    }
                    // "[a = 1]"
                    if !self.skip_initializer_in_type(TypeExpr::PatternInitializer)? {
                        self.lexer.expect(T::TCloseBracket)?;
                        break;
                    }
                }
            }''')

# object pattern: computed name on the branch that reports the token today, initializer on the missing "}"
s = rep(s, '''                self.lexer.next()?;

                while self.lexer.token != T::TCloseBrace {
                    let mut found_identifier = false;
''', '''                self.lexer.next()?;

                loop {
                while self.lexer.token != T::TCloseBrace {
                    let mut found_identifier = false;
''')
s = rep(s, '''                            if self.lexer.is_identifier_or_keyword() {
                                // "{if: x}"
                                self.lexer.next()?;
                            } else {
                                self.lexer.unexpected()?;
                            }''', '''                            if self.lexer.is_identifier_or_keyword() {
                                // "{if: x}"
                                self.lexer.next()?;
                            } else if !self.skip_binding_start_in_type(false)? {
                                // not "{[a]: x}"
                                self.lexer.unexpected()?;
                            }''')
s = rep(s, '''                    if self.lexer.token != T::TComma {
                        break;
                    }

                    self.lexer.next()?;
                }

                self.lexer.expect(T::TCloseBrace)?;
            }
            _ => {
                self.lexer.unexpected()?;
                return Err(crate::Error::SyntaxError);
            }''', '''                    if self.lexer.token != T::TComma {
                        break;
                    }

                    self.lexer.next()?;
                }

                if self.lexer.token == T::TCloseBrace {
                    self.lexer.next()?;
                    break;
                }
                // "{a = 1}"
                if !self.skip_initializer_in_type(TypeExpr::PatternInitializer)? {
                    self.lexer.expect(T::TCloseBrace)?;
                    break;
                }
                }
            }
            _ => {
                // "(@a b)"
                if self.skip_binding_start_in_type(TOP)? {
                    return self.skip_type_script_binding_at::<false>();
                }
                self.lexer.unexpected()?;
                return Err(crate::Error::SyntaxError);
            }''')

# --- the constraint of a type parameter
s = rep(s, '''            // "class Foo<T extends number> {}"
            if self.lexer.token == T::TExtends {
                result = SkipTypeParameterResult::DefinitelyTypeParameters;
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
            }''', '''            // "class Foo<T extends number> {}"
            if self.lexer.token == T::TExtends {
                result = SkipTypeParameterResult::DefinitelyTypeParameters;
                self.lexer.next()?;
                self.skip_type_script_type_with_opts::<Discard>(
                    Level::Lowest,
                    SkipTypeOptionsBitset::only(SkipTypeOptions::ConstraintStart),
                    &mut (),
                )?;
            }''')
s = rep(s, '''                    if self.lexer.token == T::TBigIntegerLiteral {
                        self.lexer.next()?;
                        S::literal(out, TypeLiteral::Bigint);
                    } else {
                        self.lexer.expect(T::TNumericLiteral)?;
                        S::literal(out, TypeLiteral::Number);
                    }''', '''                    if self.lexer.token == T::TBigIntegerLiteral {
                        self.lexer.next()?;
                        S::literal(out, TypeLiteral::Bigint);
                    } else if self.lexer.token == T::TNumericLiteral {
                        self.lexer.next()?;
                        S::literal(out, TypeLiteral::Number);
                    } else if self.skip_constraint_expr_in_type(opts, TypeExpr::MinusOperand)? {
                        return Ok(());
                    } else {
                        self.lexer.expect(T::TNumericLiteral)?;
                        S::literal(out, TypeLiteral::Number);
                    }''')
s = rep(s, '''                        return Ok(());
                    }

                    self.lexer.unexpected()?;
                }
            }
            break;
        }
''', '''                        return Ok(());
                    }

                    // "<T extends +1>"
                    if self.skip_constraint_expr_in_type(opts, TypeExpr::Constraint)? {
                        return Ok(());
                    }
                    self.lexer.unexpected()?;
                }
            }
            break;
        }
''')
s = rep(s, '''                T::TAmpersand | T::TBar => {
                    // Support things like "type Foo = | A | B" and "type Foo = & A & B"
                    self.lexer.next()?;
                    continue;
                }''', '''                T::TAmpersand | T::TBar => {
                    // Support things like "type Foo = | A | B" and "type Foo = & A & B"
                    self.lexer.next()?;
                    return self.skip_type_script_type_with_opts::<S>(
                        level,
                        opts.difference(SkipTypeOptionsBitset::only(SkipTypeOptions::ConstraintStart)),
                        out,
                    );
                }''') if False else s
s = rep(s, '''    pub(crate) fn skip_type_script_object_type(&mut self) -> Result<(), Error> {''', '''    /// Where a type cannot start. True when the constraint of a type parameter was read as an expression.
    #[cold]
    #[inline(never)]
    fn skip_constraint_expr_in_type(
        &mut self,
        opts: SkipTypeOptionsBitset,
        kind: TypeExpr,
    ) -> Result<bool, Error> {
        if !opts.contains(SkipTypeOptions::ConstraintStart) || self.lexer.is_log_disabled {
            return Ok(false);
        }
        if matches!(kind, TypeExpr::Constraint) && !self.is_start_of_expression() {
            return Ok(false);
        }
        let _ = self.parse_expr_in_type(kind)?;
        Ok(true)
    }

    /// After a member of an object type, at a token on the same line that does not end the member.
    /// True when it was the initializer of a property or the body of an accessor.
    #[cold]
    #[inline(never)]
    fn skip_member_tail_in_type(&mut self, after_signature: bool) -> Result<bool, Error> {
        if self.lexer.is_log_disabled {
            return Ok(false);
        }
        if after_signature && self.lexer.token == T::TOpenBrace {
            let _ = self.parse_fn_body_in_type()?;
            return Ok(true);
        }
        if !after_signature && self.lexer.token == T::TEquals {
            self.lexer.next()?;
            let _ = self.parse_expr_in_type(TypeExpr::Initializer)?;
            return Ok(true);
        }
        Ok(false)
    }

    pub(crate) fn skip_type_script_object_type(&mut self) -> Result<(), Error> {''')

# the object type: the end of a member is written once for each kind of member, so the kind costs nothing
s = rep(s, """            match self.lexer.token {
                T::TColon => {
                    // Regular property
                    if !found_key {
                        self.lexer.expect(T::TIdentifier)?;
                    }

                    self.lexer.next()?;
                    self.skip_type_script_type(Level::Lowest)?;
                }
                T::TOpenParen => {
                    // Method signature
                    self.skip_typescript_fn_args()?;

                    if self.lexer.token == T::TColon {
                        self.lexer.next()?;
                        self.skip_typescript_return_type()?;
                    }
                }
                _ => {
                    if !found_key {
                        self.lexer.unexpected()?;
                        return Err(crate::Error::SyntaxError);
                    }
                }
            }
            match self.lexer.token {
                T::TCloseBrace => {}
                T::TComma | T::TSemicolon => {
                    self.lexer.next()?;
                }
                _ => {
                    if !self.lexer.has_newline_before {
                        self.lexer.unexpected()?;
                        return Err(crate::Error::SyntaxError);
                    }
                }
            }
        }""", """            match self.lexer.token {
                T::TColon => {
                    // Regular property
                    if !found_key {
                        self.lexer.expect(T::TIdentifier)?;
                    }

                    self.lexer.next()?;
                    self.skip_type_script_type(Level::Lowest)?;
                    self.skip_member_end::<MEMBER_WITH_TYPE>()?;
                }
                T::TOpenParen => {
                    // Method signature
                    self.skip_typescript_fn_args()?;

                    if self.lexer.token == T::TColon {
                        self.lexer.next()?;
                        self.skip_typescript_return_type()?;
                    }
                    self.skip_member_end::<MEMBER_SIGNATURE>()?;
                }
                _ => {
                    if !found_key {
                        self.lexer.unexpected()?;
                        return Err(crate::Error::SyntaxError);
                    }
                    self.skip_member_end::<MEMBER_NAME_ONLY>()?;
                }
            }
        }""")
s = rep(s, """    pub(crate) fn skip_type_script_object_type(&mut self) -> Result<(), Error> {""", """    /// The separator after a member of an object type.
    #[inline(always)]
    fn skip_member_end<const MEMBER: u8>(&mut self) -> Result<(), Error> {
        loop {
            match self.lexer.token {
                T::TCloseBrace => {}
                T::TComma | T::TSemicolon => {
                    self.lexer.next()?;
                }
                _ => {
                    if !self.lexer.has_newline_before {
                        // "{ a: b = 1 }", "{ get a() { } }"
                        if MEMBER != MEMBER_NAME_ONLY
                            && self.skip_member_tail_in_type(MEMBER == MEMBER_SIGNATURE)?
                        {
                            if MEMBER == MEMBER_SIGNATURE {
                                break;
                            }
                            continue;
                        }
                        self.lexer.unexpected()?;
                        return Err(crate::Error::SyntaxError);
                    }
                }
            }
            break;
        }
        Ok(())
    }

    pub(crate) fn skip_type_script_object_type(&mut self) -> Result<(), Error> {""")
s = rep(s, """// Re-export so the parser-side type alias used in this file matches the""", """const MEMBER_WITH_TYPE: u8 = 0;
const MEMBER_SIGNATURE: u8 = 1;
const MEMBER_NAME_ONLY: u8 = 2;

// Re-export so the parser-side type alias used in this file matches the""")
open(p, 'w').write(s)
print('patched', d)
