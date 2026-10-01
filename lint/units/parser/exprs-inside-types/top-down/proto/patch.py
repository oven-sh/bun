#!/usr/bin/env python3
"""Prototype of expressions inside type syntax on a COPY of src/js_parser (never the worktree).
usage: patch.py <copy of src/js_parser> [variant]
variant: "all" (default) or a string of site letters, e.g. "B", "CH", "DE", "G", "A", "BCHDE".
B parameter initializer, C binding pattern initializer and computed key, H parameter decorator,
D/E member tail (property initializer, accessor body), G constraint expression, A computed name restart.
The helper functions in p.rs, lexer.rs and the grammar file are always added.
NOENUM=1 leaves SkipTypeOptions as it is (then G cannot be switched on).
Default helper: the log stays as it is while the expression is read, and what an attempt logged is removed.
DROP=1: the expression is read with the log disabled, its messages are dropped, and an error is read a second
time with the log enabled.
Compile with ../../../build-sink-positions/quick/run.py (RELAX=1) and compare with scmp.py."""
import sys, re, os
root = sys.argv[1]; variant = sys.argv[2] if len(sys.argv) > 2 else 'all'
def sub(path, old, new, count=1):
    p = root + '/' + path; s = open(p).read()
    if s.count(old) < 1: raise SystemExit('missing in %s: %r' % (path, old[:70]))
    if count and s.count(old) != count: raise SystemExit('%d matches in %s: %r' % (s.count(old), path, old[:70]))
    open(p, 'w').write(s.replace(old, new))

# ---------------------------------------------------------------- lexer.rs
sub('lexer.rs', '''    /// Look ahead at the next n codepoints without advancing the iterator.''', '''    /// Scans again from the token that starts at `offset`: that token becomes the current token.
    #[cold]
    #[inline(never)]
    pub(crate) fn rewind_to(&mut self, offset: usize) -> Result<(), Error> {
        while self.all_comments.last().is_some_and(|c| c.loc.start as usize >= offset) {
            self.all_comments.pop();
        }
        while self
            .comments_to_preserve_before
            .last()
            .is_some_and(|c| c.loc.start as usize >= offset)
        {
            self.comments_to_preserve_before.pop();
        }
        let seen = self.current.min(self.contents.len());
        if offset < seen {
            let again = self.contents[offset..seen].iter().filter(|&&b| b == b'\\n').count();
            self.approximate_newline_count = self.approximate_newline_count.saturating_sub(again);
        }
        self.prev_error_loc = Loc::EMPTY;
        self.rescan_close_brace_as_template_token = false;
        self.current = offset;
        self.step();
        self.next()
    }

    /// Look ahead at the next n codepoints without advancing the iterator.''')

# ---------------------------------------------------------------- typescript.rs
if not os.environ.get('NOENUM'): sub('typescript.rs', '''    AllowTupleLabels,
    DisallowConditionalTypes,
}''', '''    AllowTupleLabels,
    DisallowConditionalTypes,
    IsConstraint,
}''')

# ---------------------------------------------------------------- p.rs
sub('p.rs', '''pub(crate) type NeedsJSXType = bool;
pub(crate) type ParsePassSymbolUsageType<'a>''', '''/// See [`P::type_expr_save`].
pub(crate) struct TypeExprSave<'a> {
    comments_to_preserve_before: Vec<js_ast::G::Comment>,
    parse_pass_symbol_uses: ParsePassSymbolUsageType<'a>,
    log_msgs_len: usize,
    log_errors: u32,
    log_warnings: u32,
    is_log_disabled: bool,
    emit_decorator_metadata: bool,
    has_react_hooks_suppression_before: bool,
    allow_in: bool,
    allow_private_identifiers: bool,
    has_classic_runtime_warned: bool,
    has_non_local_export_declare_inside_namespace: bool,
    has_import_meta: bool,
    has_with_scope: bool,
    latest_return_had_semicolon: bool,
    needs_jsx_import: NeedsJSXType,
    top_level_await_keyword: bun_ast::Range,
    esm_import_keyword: bun_ast::Range,
    fn_or_arrow_data_parse: FnOrArrowDataParse,
    latest_arrow_arg_loc: bun_ast::Loc,
    forbid_suffix_after_as_loc: bun_ast::Loc,
    after_arrow_body_loc: bun_ast::Loc,
    current_scope: js_ast::StoreRef<Scope>,
    current_scope_children_len: usize,
    scopes_in_order_len: usize,
    scopes_in_order_for_enum_len: usize,
    import_records_len: usize,
}

/// What `P::parse_expr_in_type` reads.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum TypeExprKind {
    ComputedName,
    Initializer,
    PatternInitializer,
    Decorator,
    Constraint,
    Heritage,
}

pub(crate) type NeedsJSXType = bool;
pub(crate) type ParsePassSymbolUsageType<'a>''')

READ_DROP = r'''        let save = self.type_expr_save();
        let start = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let first = read(self, kind);
        match first {
            Err(err)
                if !save.is_log_disabled
                    && !matches!(err, crate::Error::StackOverflow | crate::Error::Alloc(_)) =>
            {
                // The second reading logs the messages of the error.
                self.type_expr_detach(&save, true);
                self.lexer.restore(&start);
                let second = read(self, kind);
                self.type_expr_restore(save, false);
                second
            }
            other => {
                self.type_expr_restore(save, true);
                other
            }
        }
    }

'''
READ_KEEP = r'''        let save = self.type_expr_save();
        let result = read(self, kind);
        let in_attempt = save.is_log_disabled;
        self.type_expr_restore(save, in_attempt);
        result
    }

'''
sub('p.rs', '''    /// When not transpiling we dont use the renamer, so our solution is to generate really
    /// hard to collide with variables, instead of actually making things collision free
    pub(crate) fn generate_temp_ref(''', '''    /// The parse-pass state that an expression or a function body inside type syntax can change.
    #[cold]
    #[inline(never)]
    fn type_expr_save(&mut self) -> TypeExprSave<'a> {
        let comments_to_preserve_before =
            core::mem::take(&mut self.lexer.comments_to_preserve_before);
        let parse_pass_symbol_uses = self.parse_pass_symbol_uses.take();
        let emit_decorator_metadata = self.options.features.emit_decorator_metadata;
        self.options.features.emit_decorator_metadata = false;
        let log = self.log();
        TypeExprSave {
            comments_to_preserve_before,
            parse_pass_symbol_uses,
            log_msgs_len: log.msgs.len(),
            log_errors: log.errors,
            log_warnings: log.warnings,
            is_log_disabled: self.lexer.is_log_disabled,
            emit_decorator_metadata,
            has_react_hooks_suppression_before: self.lexer.has_react_hooks_suppression_before,
            allow_in: self.allow_in,
            allow_private_identifiers: self.allow_private_identifiers,
            has_classic_runtime_warned: self.has_classic_runtime_warned,
            has_non_local_export_declare_inside_namespace: self
                .has_non_local_export_declare_inside_namespace,
            has_import_meta: self.has_import_meta,
            has_with_scope: self.has_with_scope,
            latest_return_had_semicolon: self.latest_return_had_semicolon,
            needs_jsx_import: self.needs_jsx_import,
            top_level_await_keyword: self.top_level_await_keyword,
            esm_import_keyword: self.esm_import_keyword,
            fn_or_arrow_data_parse: self.fn_or_arrow_data_parse.clone(),
            latest_arrow_arg_loc: self.latest_arrow_arg_loc,
            forbid_suffix_after_as_loc: self.forbid_suffix_after_as_loc,
            after_arrow_body_loc: self.after_arrow_body_loc,
            current_scope: self.current_scope,
            current_scope_children_len: self.current_scope.children.len(),
            scopes_in_order_len: self.scopes_in_order.len(),
            scopes_in_order_for_enum_len: self.scopes_in_order_for_enum.len(),
            import_records_len: self.import_records.len(),
        }
    }

    /// Detaches the scopes pushed since `type_expr_save` and puts the scalars back; symbols and names stay.
    #[cold]
    #[inline(never)]
    fn type_expr_detach(&mut self, save: &TypeExprSave<'a>, drop_messages: bool) {
        self.lexer.is_log_disabled = save.is_log_disabled;
        if drop_messages {
            let log = self.log();
            log.msgs.truncate(save.log_msgs_len);
            log.errors = save.log_errors;
            log.warnings = save.log_warnings;
        }
        self.allow_in = save.allow_in;
        self.allow_private_identifiers = save.allow_private_identifiers;
        self.has_classic_runtime_warned = save.has_classic_runtime_warned;
        self.has_non_local_export_declare_inside_namespace =
            save.has_non_local_export_declare_inside_namespace;
        self.has_import_meta = save.has_import_meta;
        self.has_with_scope = save.has_with_scope;
        self.latest_return_had_semicolon = save.latest_return_had_semicolon;
        self.needs_jsx_import = save.needs_jsx_import;
        self.top_level_await_keyword = save.top_level_await_keyword;
        self.esm_import_keyword = save.esm_import_keyword;
        self.fn_or_arrow_data_parse = save.fn_or_arrow_data_parse.clone();
        self.latest_arrow_arg_loc = save.latest_arrow_arg_loc;
        self.forbid_suffix_after_as_loc = save.forbid_suffix_after_as_loc;
        self.after_arrow_body_loc = save.after_arrow_body_loc;
        let mut scope = save.current_scope;
        scope.children.truncate(save.current_scope_children_len);
        self.current_scope = scope;
        self.scopes_in_order.truncate(save.scopes_in_order_len);
        while self.scopes_in_order_for_enum.len() > save.scopes_in_order_for_enum_len {
            self.scopes_in_order_for_enum.pop();
        }
        self.import_records.truncate(save.import_records_len);
    }

    /// Leaves the parse pass as if the syntax read since `type_expr_save` were absent.
    #[cold]
    #[inline(never)]
    fn type_expr_restore(&mut self, save: TypeExprSave<'a>, drop_messages: bool) {
        self.type_expr_detach(&save, drop_messages);
        let mut comments = save.comments_to_preserve_before;
        comments.append(&mut self.lexer.comments_to_preserve_before);
        self.lexer.comments_to_preserve_before = comments;
        self.lexer.has_react_hooks_suppression_before |= save.has_react_hooks_suppression_before;
        self.parse_pass_symbol_uses = save.parse_pass_symbol_uses;
        self.options.features.emit_decorator_metadata = save.emit_decorator_metadata;
    }

    /// Runs `read` on syntax that tsc reads inside a type and that leaves no trace in the parse pass.
    #[cold]
    #[inline(never)]
    fn read_in_type<R>(
        &mut self,
        kind: TypeExprKind,
        read: fn(&mut Self, TypeExprKind) -> Result<R, crate::Error>,
    ) -> Result<R, crate::Error> {
@@READ_BODY@@    fn read_expr_in_type(&mut self, kind: TypeExprKind) -> Result<Expr, crate::Error> {
        match kind {
            TypeExprKind::ComputedName => {
                self.allow_in = true;
                self.parse_expr(js_ast::op::Level::Lowest)
            }
            TypeExprKind::Initializer => self.parse_expr(js_ast::op::Level::Comma),
            TypeExprKind::PatternInitializer => {
                self.allow_in = true;
                self.parse_expr(js_ast::op::Level::Comma)
            }
            TypeExprKind::Decorator => {
                let mut expr = Expr::EMPTY;
                self.parse_expr_with_flags(
                    js_ast::op::Level::New,
                    js_ast::expr::EFlags::TsDecorator,
                    &mut expr,
                )
                .map(|()| expr)
            }
            TypeExprKind::Constraint => self.parse_expr(js_ast::op::Level::Prefix),
            TypeExprKind::Heritage => self.parse_expr(js_ast::op::Level::New),
        }
    }

    fn read_fn_body_in_type(&mut self, _: TypeExprKind) -> Result<G::FnBody, crate::Error> {
        let brace = self.lexer.loc();
        let args_loc = bun_ast::Loc { start: brace.start - 1 };
        self.push_scope_for_parse_pass(js_ast::scope::Kind::FunctionArgs, args_loc)?;
        self.parse_fn_body(&mut FnOrArrowDataParse::default())
    }

    fn read_binding_in_type(&mut self, _: TypeExprKind) -> Result<Binding, crate::Error> {
        self.parse_binding(crate::parser::ParseBindingOptions::default())
    }

    /// An expression that tsc reads inside type syntax. The scopes it pushed are detached; its symbols stay.
    pub(crate) fn parse_expr_in_type(&mut self, kind: TypeExprKind) -> Result<Expr, crate::Error> {
        self.read_in_type(kind, Self::read_expr_in_type)
    }

    /// The body of an accessor in a type literal or an interface. The lexer is at its "{".
    pub(crate) fn parse_fn_body_in_type(&mut self) -> Result<G::FnBody, crate::Error> {
        self.read_in_type(TypeExprKind::Initializer, Self::read_fn_body_in_type)
    }

    /// A binding pattern of a signature parameter: its names are name refs, nothing is declared.
    pub(crate) fn parse_binding_in_type(&mut self) -> Result<Binding, crate::Error> {
        self.read_in_type(TypeExprKind::PatternInitializer, Self::read_binding_in_type)
    }

    /// Removes the messages at or after `offset` that a failed reading logged.
    #[cold]
    #[inline(never)]
    pub(crate) fn drop_log_from(&mut self, offset: usize) {
        let log = self.log();
        while let Some(last) = log.msgs.last() {
            let Some(location) = &last.data.location else { break };
            if location.offset < offset {
                break;
            }
            match last.kind {
                bun_ast::Kind::Err => log.errors = log.errors.saturating_sub(1),
                bun_ast::Kind::Warn => log.warnings = log.warnings.saturating_sub(1),
                _ => {}
            }
            log.msgs.pop();
        }
        self.lexer.prev_error_loc = bun_ast::Loc::EMPTY;
    }

    /// When not transpiling we dont use the renamer, so our solution is to generate really
    /// hard to collide with variables, instead of actually making things collision free
    pub(crate) fn generate_temp_ref('''.replace('@@READ_BODY@@', READ_DROP if os.environ.get('DROP') else READ_KEEP))

on = lambda c: variant == 'all' or c in variant
G = 'parse/parse_skip_typescript.rs'
sub(G, '''use crate::p::P;
use crate::parse::type_sink''', '''use crate::p::{P, TypeExprKind};
use crate::parse::type_sink''')

# ---- cold helpers of the grammar
sub(G, '''    pub(crate) fn skip_typescript_fn_args(&mut self) -> Result<(), Error> {''', '''    /// "= expression" after a parameter. False when the token is not "=".
    #[cold]
    #[inline(never)]
    fn skip_initializer_in_type(&mut self, kind: TypeExprKind) -> Result<bool, Error> {
        if self.lexer.token != T::TEquals {
            return Ok(false);
        }
        self.lexer.next()?;
        self.parse_expr_in_type(kind)?;
        Ok(true)
    }

    /// "@decorator" before a parameter, or today's error.
    #[cold]
    #[inline(never)]
    fn skip_binding_after_decorators(&mut self) -> Result<(), Error> {
        if self.lexer.token != T::TAt {
            self.lexer.unexpected()?;
            return Err(crate::Error::SyntaxError);
        }
        while self.lexer.token == T::TAt {
            self.lexer.next()?;
            self.parse_expr_in_type(TypeExprKind::Decorator)?;
        }
        self.skip_type_script_binding()
    }

    /// "[key]" of a property in an object binding pattern, or today's error.
    #[cold]
    #[inline(never)]
    fn skip_computed_key_in_binding(&mut self) -> Result<(), Error> {
        if self.lexer.token != T::TOpenBracket {
            self.lexer.unexpected()?;
            return Ok(());
        }
        self.lexer.next()?;
        self.skip_type_script_type_with_opts::<Discard>(
            Level::Lowest,
            SkipTypeOptionsBitset::only(SkipTypeOptions::IsIndexSignature),
            &mut (),
        )?;
        self.lexer.expect(T::TCloseBracket)?;
        Ok(())
    }

    /// What tsc reads where a member of an object type should end: an initializer or an accessor body.
    #[cold]
    #[inline(never)]
    fn skip_member_tail_in_type(&mut self) -> Result<(), Error> {
        match self.lexer.token {
            T::TEquals => {
                self.lexer.next()?;
                self.parse_expr_in_type(TypeExprKind::Initializer)?;
                match self.lexer.token {
                    T::TCloseBrace => Ok(()),
                    T::TComma | T::TSemicolon => {
                        self.lexer.next()?;
                        Ok(())
                    }
                    _ => {
                        if !self.lexer.has_newline_before {
                            self.lexer.unexpected()?;
                            return Err(crate::Error::SyntaxError);
                        }
                        Ok(())
                    }
                }
            }
            T::TOpenBrace => self.parse_fn_body_in_type().map(|_| ()),
            _ => {
                self.lexer.unexpected()?;
                Err(crate::Error::SyntaxError)
            }
        }
    }

    /// An expression where the constraint of a type parameter should be a type.
    #[cold]
    #[inline(never)]
    fn skip_constraint_expr_in_type(&mut self) -> Result<(), Error> {
        self.parse_expr_in_type(TypeExprKind::Constraint).map(|_| ())
    }

    /// Reads "[" ... "]" of an object type member as an expression after the reading as a type failed.
    #[cold]
    #[inline(never)]
    fn retry_computed_name_as_expr(&mut self, open: usize, err: Option<Error>) -> Result<(), Error> {
        if let Some(err) = err {
            if self.lexer.is_log_disabled || matches!(err, Error::StackOverflow | Error::Alloc(_)) {
                return Err(err);
            }
        } else if self.lexer.is_log_disabled {
            return Ok(());
        }
        let was_disabled = self.lexer.is_log_disabled;
        self.lexer.is_log_disabled = true;
        let found = match self.lexer.rewind_to(open).and_then(|()| self.lexer.next()) {
            Ok(()) => {
                self.parse_expr_in_type(TypeExprKind::ComputedName).is_ok()
                    && self.lexer.token == T::TCloseBracket
            }
            Err(_) => false,
        };
        self.lexer.is_log_disabled = was_disabled;
        if !was_disabled {
            self.drop_log_from(open);
        }
        if found {
            return Ok(());
        }
        self.lexer.rewind_to(open)?;
        self.lexer.next()?;
        self.skip_type_script_type_with_opts::<Discard>(
            Level::Lowest,
            SkipTypeOptionsBitset::only(SkipTypeOptions::IsIndexSignature),
            &mut (),
        )
    }

    pub(crate) fn skip_typescript_fn_args(&mut self) -> Result<(), Error> {''')

# ---- B: parameter initializer
if on('B'): sub(G, '''            // "(a, b)"
            if self.lexer.token != T::TComma {
                break;
            }

            self.lexer.next()?;
        }

        self.lexer.expect(T::TCloseParen)?;''', '''            // "(a, b)"
            if self.lexer.token != T::TComma {
                if self.lexer.token == T::TCloseParen
                    || !self.skip_initializer_in_type(TypeExprKind::Initializer)?
                    || self.lexer.token != T::TComma
                {
                    break;
                }
            }

            self.lexer.next()?;
        }

        self.lexer.expect(T::TCloseParen)?;''')

# ---- C: binding pattern elements
if on('C'): sub(G, '''                    self.skip_type_script_binding()?;

                    if self.lexer.token != T::TComma {
                        break;
                    }
                    self.lexer.next()?;
                }

                self.lexer.expect(T::TCloseBracket)?;''', '''                    self.skip_type_script_binding()?;

                    if self.lexer.token != T::TComma {
                        if self.lexer.token == T::TCloseBracket
                            || !self.skip_initializer_in_type(TypeExprKind::PatternInitializer)?
                            || self.lexer.token != T::TComma
                        {
                            break;
                        }
                    }
                    self.lexer.next()?;
                }

                self.lexer.expect(T::TCloseBracket)?;''')
if on('C'): sub(G, '''                    if self.lexer.token != T::TComma {
                        break;
                    }

                    self.lexer.next()?;
                }

                self.lexer.expect(T::TCloseBrace)?;''', '''                    if self.lexer.token != T::TComma {
                        if self.lexer.token == T::TCloseBrace
                            || !self.skip_initializer_in_type(TypeExprKind::PatternInitializer)?
                            || self.lexer.token != T::TComma
                        {
                            break;
                        }
                    }

                    self.lexer.next()?;
                }

                self.lexer.expect(T::TCloseBrace)?;''')
if on('C'): sub(G, '''                            if self.lexer.is_identifier_or_keyword() {
                                // "{if: x}"
                                self.lexer.next()?;
                            } else {
                                self.lexer.unexpected()?;
                            }''', '''                            if self.lexer.is_identifier_or_keyword() {
                                // "{if: x}"
                                self.lexer.next()?;
                            } else {
                                self.skip_computed_key_in_binding()?;
                            }''')
# ---- H: decorators
if on('H'): sub(G, '''            _ => {
                self.lexer.unexpected()?;
                return Err(crate::Error::SyntaxError);
            }
        }
        Ok(())
    }

    /// "= expression" after a parameter.''', '''            _ => {
                return self.skip_binding_after_decorators();
            }
        }
        Ok(())
    }

    /// "= expression" after a parameter.''')
# ---- D, E: member tail
if on('D') or on('E'): sub(G, '''                _ => {
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
            }''', '''                _ => {
                    if !found_key {
                        self.skip_member_tail_in_type()?;
                        continue;
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
                        self.skip_member_tail_in_type()?;
                    }
                }
            }''')
# ---- G: constraint
if on('G'): sub(G, '''            if self.lexer.token == T::TExtends {
                result = SkipTypeParameterResult::DefinitelyTypeParameters;
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
            }''', '''            if self.lexer.token == T::TExtends {
                result = SkipTypeParameterResult::DefinitelyTypeParameters;
                self.lexer.next()?;
                self.skip_type_script_type_with_opts::<Discard>(
                    Level::Lowest,
                    SkipTypeOptionsBitset::only(SkipTypeOptions::IsConstraint),
                    &mut (),
                )?;
            }''')
if on('G'): sub(G, '''                    } else {
                        self.lexer.expect(T::TNumericLiteral)?;
                        S::literal(out, TypeLiteral::Number);
                    }''', '''                    } else {
                        if self.lexer.token != T::TNumericLiteral {
                            if opts.contains(SkipTypeOptions::IsConstraint) {
                                return self.skip_constraint_expr_in_type();
                            }
                            self.lexer.expected(T::TNumericLiteral)?;
                        }
                        self.lexer.next()?;
                        S::literal(out, TypeLiteral::Number);
                    }''')
if on('G'): sub(G, '''                        return Ok(());
                    }

                    self.lexer.unexpected()?;
                }
            }
            break;''', '''                        return Ok(());
                    }

                    if opts.contains(SkipTypeOptions::IsConstraint) {
                        return self.skip_constraint_expr_in_type();
                    }
                    self.lexer.unexpected()?;
                }
            }
            break;''')
# ---- A: computed name
if on('A'): sub(G, '''            if self.lexer.token == T::TOpenBracket {
                // Index signature or computed property
                self.lexer.next()?;
                self.skip_type_script_type_with_opts::<Discard>(
                    Level::Lowest,
                    SkipTypeOptionsBitset::only(SkipTypeOptions::IsIndexSignature),
                    &mut (),
                )?;
''', '''            if self.lexer.token == T::TOpenBracket {
                // Index signature or computed property
                let open = self.lexer.start;
                self.lexer.next()?;
                if let Err(err) = self.skip_type_script_type_with_opts::<Discard>(
                    Level::Lowest,
                    SkipTypeOptionsBitset::only(SkipTypeOptions::IsIndexSignature),
                    &mut (),
                ) {
                    self.retry_computed_name_as_expr(open, Some(err))?;
                }
''')
if on('A'): sub(G, '''                            self.skip_type_script_type(Level::Lowest)?;
                        }
                    }
                    _ => {}
                }

                self.lexer.expect(T::TCloseBracket)?;''', '''                            self.skip_type_script_type(Level::Lowest)?;
                        }
                    }
                    _ => {
                        if self.lexer.token != T::TCloseBracket
                            || self.lexer.prev_error_loc.start > open as i32
                        {
                            self.retry_computed_name_as_expr(open, None)?;
                        }
                    }
                }

                self.lexer.expect(T::TCloseBracket)?;''')
