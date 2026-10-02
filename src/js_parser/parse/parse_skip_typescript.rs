#![warn(unused_must_use)]
use crate::Error;
use crate::lexer::T;
use crate::p::P;
use crate::parse::lists::{ListKind, ListStep};
use crate::parser::{
    FnOrArrowDataParse, ParseStatementOptions, Ref, SkipTypeParameterResult, TypeParameterFlag,
};
use crate::sema::keep::{BracketKind, ObjectTypeBuilder, TypeMemberParts};
use crate::typescript;
use crate::typescript::SkipTypeOptions;
use crate::typescript::identifier::{Kind as TsIdentKind, kind_for_identifier};
use bun_ast::StoreStr;
use bun_ast::op::Level;
use bun_ast::ts::Metadata;
use bun_ast::ts_syntax::{
    Flags, Name, Param, PatternElement, PatternId, PatternProperty, PropertyKey, ResolutionMode,
    SignatureKind, ThisParam, TupleElement, TypeData, TypeId, TypeParam,
};

// Re-export so the parser-side type alias used in this file matches the
// canonical definition in `TypeScript.rs`.
pub(crate) type SkipTypeOptionsBitset = typescript::SkipTypeOptionsBitset;

/// Whether nothing has been skipped yet of the type that `option` was given for. By itself `opts` does not tell: it goes down to the
/// operands of "|" and "&".
#[inline(always)]
fn is_at_start_of(
    option: SkipTypeOptions,
    opts: SkipTypeOptionsBitset,
    level: Level,
    leading_operator: Option<T>,
) -> bool {
    opts.contains(option) && level == Level::Lowest && leading_operator.is_none()
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    #[inline]
    pub(crate) fn skip_typescript_return_type(&mut self) -> Result<(), Error> {
        if self.should_keep_types() {
            return self.parse_and_keep_type(
                Level::Lowest,
                SkipTypeOptionsBitset::only(SkipTypeOptions::IsReturnType),
            );
        }
        self.skip_type_script_type_with_opts::<false>(
            Level::Lowest,
            SkipTypeOptionsBitset::only(SkipTypeOptions::IsReturnType),
            None,
        )
    }

    #[inline]
    pub(crate) fn skip_typescript_return_type_with_metadata(&mut self) -> Result<Metadata, Error> {
        let mut result = Metadata::DEFAULT;
        self.skip_type_script_type_with_opts::<true>(
            Level::Lowest,
            SkipTypeOptionsBitset::only(SkipTypeOptions::IsReturnType),
            Some(&mut result),
        )?;
        Ok(result)
    }

    #[inline]
    pub(crate) fn skip_type_script_type(&mut self, level: Level) -> Result<(), Error> {
        self.mark_type_script_only();
        if self.should_keep_types() {
            return self.parse_and_keep_type(level, SkipTypeOptionsBitset::empty());
        }
        self.skip_type_script_type_with_opts::<false>(level, SkipTypeOptionsBitset::empty(), None)
    }

    /// Keep mode entry point: parses the type like `skip_type_script_type`, builds its node, and records it by start offset.
    #[cold]
    #[inline(never)]
    pub(crate) fn parse_and_keep_type(
        &mut self,
        level: Level,
        opts: SkipTypeOptionsBitset,
    ) -> Result<(), Error> {
        let start = self.lexer.loc().start;
        let (type_stack_len, name_stack_len) = {
            let syntax = self.type_syntax_mut();
            (syntax.type_stack.len(), syntax.name_stack.len())
        };
        let result = self.skip_type_script_type_impl::<false, true>(level, opts, None);
        // An error can leave unfinished lists on the shared stacks.
        let syntax = self.type_syntax_mut();
        syntax.type_stack.truncate(type_stack_len);
        syntax.name_stack.truncate(name_stack_len);
        let ty = syntax.last_type;
        if result.is_ok() && ty.is_some() {
            self.record_type(start, ty);
        }
        result
    }

    /// Parses a type nested inside another type.
    #[inline]
    fn skip_nested_type<const KEEP: bool>(
        &mut self,
        level: Level,
        opts: SkipTypeOptionsBitset,
    ) -> Result<(), Error> {
        self.skip_type_script_type_impl::<false, KEEP>(level, opts, None)
    }

    #[inline]
    pub(crate) fn skip_type_script_type_with_metadata(
        &mut self,
        level: Level,
    ) -> Result<Metadata, Error> {
        self.mark_type_script_only();
        let mut result = Metadata::DEFAULT;
        self.skip_type_script_type_with_opts::<true>(
            level,
            SkipTypeOptionsBitset::empty(),
            Some(&mut result),
        )?;
        Ok(result)
    }

    pub(crate) fn skip_type_script_binding(&mut self) -> Result<(), Error> {
        self.mark_type_script_only();
        // Nested destructuring patterns in skipped type positions recurse through
        // this function; bound it like `parse_binding` does.
        if !self.stack_check.is_safe_to_recurse() {
            return Err(crate::Error::StackOverflow);
        }
        // Keep mode stores the result in `TypeSyntax::last_binding`.
        let keeps = self.should_keep_types();
        let pos = if keeps { self.token_start() } else { 0 };
        match self.lexer.token {
            T::TIdentifier | T::TThis => {
                if keeps {
                    self.emit_identifier_binding();
                }
                self.lexer.next()?;
            }
            T::TOpenBracket => {
                self.lexer.next()?;
                let mut elements: Vec<PatternElement> = Vec::new();

                // "[, , a]"
                while self.lexer.token == T::TComma {
                    if keeps {
                        elements.push(self.emit_array_hole());
                    }
                    self.lexer.next()?;
                }
                // "[a, b]"
                while self.lexer.token != T::TCloseBracket {
                    // "[a, , b]": `parseArrayBindingElement` leaves an element out wherever a comma stands.
                    if self.lexer.token == T::TComma && self.lexer.tolerant {
                        if keeps {
                            elements.push(self.emit_array_hole());
                        }
                        self.lexer.next()?;
                        continue;
                    }

                    // "[...a]"
                    let loc = self.lexer.loc();
                    let is_rest = self.lexer.token == T::TDotDotDot;
                    if self.lexer.token == T::TDotDotDot {
                        self.lexer.next()?;
                    }

                    self.skip_type_script_binding()?;
                    let pattern = if keeps {
                        self.type_syntax_mut().last_binding
                    } else {
                        PatternId::NONE
                    };
                    // "[a = 1]"
                    let mut default = None;
                    if self.lexer.token == T::TEquals && self.lexer.tolerant {
                        default = Some(self.skip_initializer_in_signature()?);
                    }
                    if keeps {
                        elements.push(PatternElement {
                            pattern,
                            default,
                            is_rest,
                            loc,
                        });
                    }

                    if self.lexer.token != T::TComma {
                        break;
                    }
                    self.lexer.next()?;
                }

                self.lexer.expect(T::TCloseBracket)?;
                if keeps {
                    self.emit_array_binding(&elements, pos);
                }
            }
            T::TOpenBrace => {
                self.lexer.next()?;
                let mut properties: Vec<PatternProperty> = Vec::new();

                while self.lexer.token != T::TCloseBrace {
                    let mut found_identifier = false;
                    // Filled in as the property is parsed. Only used in keep mode.
                    let mut property = PatternProperty {
                        key: if keeps {
                            self.simple_property_key()
                        } else {
                            PropertyKey::None
                        },
                        value: PatternId::NONE,
                        default: None,
                        is_rest: false,
                        loc: self.lexer.loc(),
                    };

                    match self.lexer.token {
                        T::TIdentifier => {
                            found_identifier = true;
                            self.lexer.next()?;
                        }

                        // "{...x}"
                        T::TDotDotDot => {
                            self.lexer.next()?;

                            if self.lexer.token != T::TIdentifier {
                                self.lexer.unexpected()?;
                            }

                            found_identifier = true;
                            if keeps {
                                self.emit_identifier_binding();
                                property.is_rest = true;
                            }
                            self.lexer.next()?;
                        }

                        // "{1: y}"
                        // "{'x': y}"
                        T::TStringLiteral | T::TNumericLiteral => {
                            self.lexer.next()?;
                        }

                        // "{1n: y}": `isLiteralPropertyName`
                        T::TBigIntegerLiteral if self.lexer.tolerant => {
                            self.lexer.next()?;
                        }

                        // "{[x]: y}"
                        T::TOpenBracket if self.lexer.tolerant => {
                            property.key =
                                PropertyKey::Computed(self.skip_computed_property_name()?);
                        }

                        _ => {
                            if self.lexer.is_identifier_or_keyword() {
                                // "{if: x}"
                                self.lexer.next()?;
                            } else {
                                self.lexer.unexpected()?;
                            }
                        }
                    }

                    if self.lexer.token == T::TColon || !found_identifier {
                        self.lexer.expect(T::TColon)?;
                        self.skip_type_script_binding()?;
                    } else if keeps && !property.is_rest {
                        // "{x}" binds the property name itself.
                        self.emit_shorthand_binding(&property);
                    }
                    if keeps {
                        property.value = self.type_syntax_mut().last_binding;
                    }
                    // "{a = 1}", "{a: b = 1}"
                    if self.lexer.token == T::TEquals && self.lexer.tolerant {
                        property.default = Some(self.skip_initializer_in_signature()?);
                    }
                    if keeps {
                        properties.push(property);
                    }

                    if self.lexer.token != T::TComma {
                        break;
                    }

                    self.lexer.next()?;
                }

                self.lexer.expect(T::TCloseBrace)?;
                if keeps {
                    self.emit_object_binding(&properties, pos);
                }
            }
            _ => {
                self.lexer.unexpected()?;
                return Err(crate::Error::SyntaxError);
            }
        }
        Ok(())
    }

    pub(crate) fn skip_typescript_fn_args(&mut self) -> Result<(), Error> {
        self.mark_type_script_only();

        let open_paren = self.lexer.loc().start;
        self.lexer.expect(T::TOpenParen)?;
        // Keep mode stores the result in `TypeSyntax::last_params`.
        let keeps = self.should_keep_types();
        let mut parameters: Vec<Param> = Vec::new();
        let mut this_param = Some(ThisParam::NONE);

        while self.lexer.token != T::TCloseParen {
            let mut parameter = Param {
                pattern: PatternId::NONE,
                ty: TypeId::NONE,
                default: None,
                flags: Flags::empty(),
                modifiers: Default::default(),
                rest_loc: bun_ast::Loc::EMPTY,
                question_loc: bun_ast::Loc::EMPTY,
                loc: self.lexer.loc(),
            };
            // "(public a)": `parseParameterEx` takes modifiers on every parameter, and the checker reports them (2369).
            if self.lexer.tolerant && self.lexer.token == T::TIdentifier {
                self.skip_parameter_modifiers(&mut parameter)?;
            }
            // "(...a)"
            if self.lexer.token == T::TDotDotDot {
                parameter.rest_loc = self.lexer.loc();
                self.lexer.next()?;
                parameter.flags |= Flags::REST;
            }

            let (is_this, name_loc) = (self.lexer.token == T::TThis, self.lexer.loc());
            self.skip_type_script_binding()?;
            if keeps {
                parameter.pattern = self.type_syntax_mut().last_binding;
            }

            // "(a?)"
            if self.lexer.token == T::TQuestion {
                parameter.question_loc = self.lexer.loc();
                self.lexer.next()?;
                parameter.flags |= Flags::OPTIONAL;
            }

            // "(a: any)"
            let mut is_complete = true;
            if self.lexer.token == T::TColon {
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
                if keeps {
                    parameter.ty = self.last_type();
                    is_complete = parameter.ty.is_some();
                }
            }
            // "(a = 1)": `parseParameterEx` takes an initializer on every parameter, and the checker reports it (2371).
            if self.lexer.token == T::TEquals && self.lexer.tolerant {
                parameter.default = Some(self.skip_initializer_in_signature()?);
            }
            if keeps {
                if !is_complete || (parameter.pattern.is_none() && !is_this) {
                    this_param = None;
                } else if is_this {
                    this_param = this_param.and(Some(ThisParam {
                        ty: parameter.ty,
                        loc: name_loc,
                    }));
                } else {
                    parameters.push(parameter);
                }
            }

            // "(a, b)"
            if self.lexer.token != T::TComma {
                break;
            }

            self.lexer.next()?;
        }

        self.lexer.expect(T::TCloseParen)?;
        if keeps {
            self.finish_params(&parameters, this_param, open_paren);
        }
        Ok(())
    }

    /// `isIndexSignature`, at the "[" of a member of a type or a class. Only looks.
    #[cold]
    #[inline(never)]
    pub(crate) fn is_unambiguously_index_signature(&mut self) -> bool {
        let (here, swallowed) = (self.lexer.snapshot(), self.lexer.swallowed);
        self.lexer.is_log_disabled = true;
        let found = self
            .next_is_unambiguously_index_signature()
            .unwrap_or(false);
        self.lexer.restore(&here);
        self.lexer.swallowed = swallowed;
        found
    }

    /// `nextIsUnambiguouslyIndexSignature`
    fn next_is_unambiguously_index_signature(&mut self) -> Result<bool, Error> {
        self.lexer.next()?;
        if matches!(self.lexer.token, T::TDotDotDot | T::TCloseBracket) {
            return Ok(true);
        }
        if self.is_modifier_kind() {
            self.lexer.next()?;
            if self.is_identifier_in_context() {
                return Ok(true);
            }
        } else if !self.is_identifier_in_context() {
            return Ok(false);
        } else {
            self.lexer.next()?;
        }
        if matches!(self.lexer.token, T::TColon | T::TComma) {
            return Ok(true);
        }
        if self.lexer.token != T::TQuestion {
            return Ok(false);
        }
        self.lexer.next()?;
        Ok(matches!(
            self.lexer.token,
            T::TColon | T::TComma | T::TCloseBracket
        ))
    }

    /// `parseBracketedList(PCParameters, parseParameter, "[", "]")`, at the "[" of an index signature. TypeScript's parser takes any
    /// parameters there, and its checker objects (`checkGrammarIndexSignatureParameters`).
    #[cold]
    #[inline(never)]
    pub(crate) fn skip_index_signature_parameters(&mut self) -> Result<(), Error> {
        self.skip_index_signature_parameter_list()?;
        Ok(())
    }

    /// Returns where the comma before the "]" is, if there is one. Keep mode stores the parameters in `TypeSyntax::last_params`.
    #[cold]
    #[inline(never)]
    fn skip_index_signature_parameter_list(&mut self) -> Result<Option<bun_ast::Loc>, Error> {
        let open_bracket = self.lexer.loc().start;
        self.lexer.expect(T::TOpenBracket)?;
        let keeps = self.should_keep_types();
        let mut parameters: Vec<Param> = Vec::new();
        let mut this_param = Some(ThisParam::NONE);
        let mut trailing_comma = None;

        let saved_contexts = self.enter_list(ListKind::Parameters);
        while self.lexer.token != T::TCloseBracket {
            match self.classify_list_token(ListKind::Parameters)? {
                ListStep::Element => {}
                ListStep::Skipped => continue,
                ListStep::Over => break,
            }
            trailing_comma = None;
            let parameter_start = self.lexer.loc();
            let mut parameter = Param {
                pattern: PatternId::NONE,
                ty: TypeId::NONE,
                default: None,
                flags: Flags::empty(),
                modifiers: Default::default(),
                rest_loc: bun_ast::Loc::EMPTY,
                question_loc: bun_ast::Loc::EMPTY,
                loc: parameter_start,
            };
            if self.lexer.token == T::TIdentifier {
                self.skip_parameter_modifiers(&mut parameter)?;
            }
            if self.lexer.token == T::TDotDotDot {
                parameter.rest_loc = self.lexer.loc();
                self.lexer.next()?;
                parameter.flags |= Flags::REST;
            }

            let (is_this, name_loc) = (self.lexer.token == T::TThis, self.lexer.loc());
            if matches!(
                self.lexer.token,
                T::TIdentifier | T::TThis | T::TOpenBracket | T::TOpenBrace
            ) {
                self.skip_type_script_binding()?;
                if keeps {
                    parameter.pattern = self.type_syntax_mut().last_binding;
                }
            } else {
                // `parseNameOfParameter`: the name is missing, and the token stays.
                if keeps {
                    parameter.pattern = self.emit_array_hole().pattern;
                }
                self.lexer.expect(T::TIdentifier)?;
            }
            if self.lexer.token == T::TQuestion {
                parameter.question_loc = self.lexer.loc();
                self.lexer.next()?;
                parameter.flags |= Flags::OPTIONAL;
            }
            let mut is_complete = true;
            if self.lexer.token == T::TColon {
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
                if keeps {
                    parameter.ty = self.last_type();
                    is_complete = parameter.ty.is_some();
                }
            }
            if self.lexer.token == T::TEquals {
                parameter.default = Some(self.skip_initializer_in_signature()?);
            }
            if keeps {
                if !is_complete || (parameter.pattern.is_none() && !is_this) {
                    this_param = None;
                } else if is_this {
                    this_param = this_param.and(Some(ThisParam {
                        ty: parameter.ty,
                        loc: name_loc,
                    }));
                } else {
                    parameters.push(parameter);
                }
            }

            if self.lexer.token != T::TComma {
                if self.recover_missing_comma(ListKind::Parameters, parameter_start)? {
                    continue;
                }
                break;
            }
            trailing_comma = Some(self.lexer.loc());
            self.lexer.next()?;
        }
        self.lexer.list_contexts = saved_contexts;

        self.lexer.expect(T::TCloseBracket)?;
        if keeps {
            self.finish_params(&parameters, this_param, open_bracket);
        }
        Ok(trailing_comma)
    }

    /// `parseModifiers` at the start of a parameter. A modifier keyword is a modifier if a parameter can continue after it
    /// (`nextTokenCanFollowModifier`): on the same line, except after "static".
    #[cold]
    #[inline(never)]
    fn skip_parameter_modifiers(&mut self, parameter: &mut Param) -> Result<(), Error> {
        let mut modifiers: Vec<bun_ast::ts_syntax::Modifier> = Vec::new();
        while self.lexer.token == T::TIdentifier
            && let Some(flag) = crate::lexer::PropertyModifierKeyword::find(self.lexer.raw())
                .and_then(crate::sema::keep::modifier_flag)
            && self.next_token_matches(|p| {
                (!p.lexer.has_newline_before || flag == Flags::STATIC)
                    && (p.lexer.is_identifier_or_keyword()
                        || matches!(
                            p.lexer.token,
                            T::TOpenBracket
                                | T::TOpenBrace
                                | T::TAsterisk
                                | T::TDotDotDot
                                | T::TStringLiteral
                                | T::TNumericLiteral
                                | T::TBigIntegerLiteral
                        ))
            })
        {
            parameter.flags |= flag;
            modifiers.push(bun_ast::ts_syntax::Modifier {
                flag,
                loc: self.lexer.loc(),
            });
            self.lexer.next()?;
        }
        if self.should_keep_types() {
            parameter.modifiers = self.add_param_modifiers(&modifiers);
        }
        Ok(())
    }

    /// Runs `parse` on an expression or a function body that is written inside a type, and returns the result. It is not part of the
    /// AST. Keep mode stores it for the lowering.
    /// Speculative parsing only restores the lexer when it backtracks. So during a speculative parse, everything `parse` did to the
    /// parser's state is undone right away, except for the lexer's position.
    #[cold]
    #[inline(never)]
    fn parse_detached<R>(
        &mut self,
        parse: impl FnOnce(&mut Self) -> Result<R, Error>,
    ) -> Result<R, Error> {
        if !self.lexer.is_log_disabled {
            return parse(self);
        }
        let snapshot = self.parser_snapshot();
        let result = parse(self);
        let mut after = self.lexer.snapshot();
        self.restore_parser_snapshot(snapshot);
        let result = result?;
        // The comments met on the way are forgotten with the rest.
        after.all_comments_len = self.lexer.all_comments.len();
        after.comments_to_preserve_before_len = self.lexer.comments_to_preserve_before.len();
        self.lexer.restore(&after);
        Ok(result)
    }

    /// Called on the token after the "[" of an object type member. False for an index signature ("[key: string]",
    /// `isUnambiguouslyIndexSignature`) and for a mapped type ("[K in T]"), which `can_be_mapped_type` allows (`isStartOfMappedType`).
    #[cold]
    fn is_start_of_computed_member_name(&mut self, can_be_mapped_type: bool) -> bool {
        match self.lexer.token {
            T::TCloseBracket | T::TDotDotDot => false,
            _ if self.lexer.is_identifier_or_keyword() => !self.next_token_matches(|p| {
                matches!(p.lexer.token, T::TColon | T::TComma | T::TQuestion)
                    || p.lexer.token == T::TIn && can_be_mapped_type
                    || p.lexer.token != T::TIn && p.lexer.is_identifier_or_keyword()
            }),
            _ => true,
        }
    }

    /// `parseComputedPropertyName`: any expression, the comma operator and `in` included.
    #[cold]
    #[inline(never)]
    fn skip_computed_property_name(&mut self) -> Result<bun_ast::Expr, Error> {
        self.lexer.expect(T::TOpenBracket)?;
        let name = self.parse_detached(|p| {
            let old_allow_in = core::mem::replace(&mut p.allow_in, true);
            let name = p.parse_expr(Level::Lowest);
            p.allow_in = old_allow_in;
            name
        })?;
        self.lexer.expect(T::TCloseBracket)?;
        Ok(name)
    }

    /// `parseInitializer`, at the `=`. TypeScript's parser takes an initializer where a signature or a type has no use for one, and
    /// its checker objects.
    #[cold]
    #[inline(never)]
    fn skip_initializer_in_signature(&mut self) -> Result<bun_ast::Expr, Error> {
        self.lexer.expect(T::TEquals)?;
        self.parse_detached(|p| p.parse_expr(Level::Comma))
    }

    /// This is a spot where the TypeScript grammar is highly ambiguous. Here are
    /// some cases that are valid:
    ///
    /// ```ts
    /// let x = (y: any): (() => {}) => { };
    /// let x = (y: any): () => {} => { };
    /// let x = (y: any): (y) => {} => { };
    /// let x = (y: any): (y[]) => {};
    /// let x = (y: any): (a | b) => {};
    /// ```
    ///
    /// Here are some cases that aren't valid:
    ///
    /// ```ts
    /// let x = (y: any): (y) => {};
    /// let x = (y: any): (y) => {return 0};
    /// let x = (y: any): asserts y is (y) => {};
    /// ```
    ///
    pub(crate) fn skip_type_script_paren_or_fn_type<const GET_METADATA: bool, const KEEP: bool>(
        &mut self,
        result: Option<&mut Metadata>,
    ) -> Result<(), Error> {
        self.mark_type_script_only();
        let open_paren = if KEEP { self.token_start() } else { 0 };
        let head = if KEEP {
            self.type_syntax_mut().pending_fn_type_head.take()
        } else {
            None
        };

        if self.try_skip_type_script_arrow_args_with_backtracking()
            || (self.lexer.tolerant
                && !self.lexer.is_log_disabled
                && self.skip_fn_type_args_without_arrow(head.is_some())?)
        {
            let parameters = if KEEP {
                self.type_syntax_mut().last_params.take()
            } else {
                None
            };
            self.skip_typescript_return_type()?;
            if GET_METADATA {
                *result.expect("infallible: GET_METADATA implies Some") = Metadata::MFunction;
            }
            if KEEP {
                self.emit_fn_type(head, open_paren, parameters);
            }
        } else {
            self.lexer.expect(T::TOpenParen)?;
            if GET_METADATA {
                let result = result.expect("infallible: GET_METADATA implies Some");
                *result = Metadata::DEFAULT;
                self.skip_type_script_type_impl::<true, KEEP>(
                    Level::Lowest,
                    SkipTypeOptionsBitset::empty(),
                    Some(result),
                )?;
            } else {
                self.skip_type_script_type_impl::<false, KEEP>(
                    Level::Lowest,
                    SkipTypeOptionsBitset::empty(),
                    None,
                )?;
            }
            self.lexer.expect(T::TCloseParen)?;
        }
        Ok(())
    }

    /// `parseFunctionOrConstructorType`, where the attempt at "(..) =>" failed. Whether a "(" starts a function type is decided by
    /// looking ahead, not by the "=>" (`isStartOfFunctionTypeOrConstructorType`). After "new" or "<T>" (`has_head`) it always does.
    /// If it does, the parameters are skipped, a missing "=>" is reported (`shouldParseReturnType`), and the return type comes next.
    #[cold]
    #[inline(never)]
    fn skip_fn_type_args_without_arrow(&mut self, has_head: bool) -> Result<bool, Error> {
        if self.lexer.token != T::TOpenParen {
            if !has_head {
                return Ok(false);
            }
            // `parseParameters`: without a "(" the list is missing, and the token stays.
            let open_paren = self.lexer.loc().start;
            self.lexer.expect(T::TOpenParen)?;
            if self.should_keep_types() {
                self.finish_params(&[], Some(ThisParam::NONE), open_paren);
            }
        } else if has_head || self.is_unambiguously_start_of_function_type() {
            self.skip_typescript_fn_args()?;
        } else {
            return Ok(false);
        }
        self.lexer.expect(T::TEqualsGreaterThan)?;
        Ok(true)
    }

    /// Lookahead with `nextIsUnambiguouslyStartOfFunctionType`, at a "(".
    #[cold]
    #[inline(never)]
    fn is_unambiguously_start_of_function_type(&mut self) -> bool {
        let (here, swallowed) = (self.lexer.snapshot(), self.lexer.swallowed);
        self.lexer.is_log_disabled = true;
        let found = self
            .next_is_unambiguously_start_of_function_type()
            .unwrap_or(false);
        self.lexer.restore(&here);
        self.lexer.swallowed = swallowed;
        found
    }

    /// `nextIsUnambiguouslyStartOfFunctionType`
    fn next_is_unambiguously_start_of_function_type(&mut self) -> Result<bool, Error> {
        self.lexer.next()?;
        // "( )", "( ..."
        if matches!(self.lexer.token, T::TCloseParen | T::TDotDotDot) {
            return Ok(true);
        }
        // `skipParameterStart`
        if self.lexer.token == T::TIdentifier {
            let mut parameter = Param {
                pattern: PatternId::NONE,
                ty: TypeId::NONE,
                default: None,
                flags: Flags::empty(),
                modifiers: Default::default(),
                rest_loc: bun_ast::Loc::EMPTY,
                question_loc: bun_ast::Loc::EMPTY,
                loc: self.lexer.loc(),
            };
            self.skip_parameter_modifiers(&mut parameter)?;
        }
        if self.lexer.token == T::TDotDotDot {
            self.lexer.next()?;
        }
        if self.is_identifier_in_context() || self.lexer.token == T::TThis {
            self.lexer.next()?;
        } else if matches!(self.lexer.token, T::TOpenBracket | T::TOpenBrace) {
            // Only a binding pattern without errors counts.
            let swallowed = self.lexer.swallowed;
            self.skip_type_script_binding()?;
            if self.lexer.swallowed != swallowed {
                return Ok(false);
            }
        } else {
            return Ok(false);
        }
        // "( xxx :", "( xxx ,", "( xxx ?", "( xxx ="
        if matches!(
            self.lexer.token,
            T::TColon | T::TComma | T::TQuestion | T::TEquals
        ) {
            return Ok(true);
        }
        // "( xxx ) =>"
        if self.lexer.token == T::TCloseParen {
            self.lexer.next()?;
            return Ok(self.lexer.token == T::TEqualsGreaterThan);
        }
        Ok(false)
    }

    /// `parseFunctionOrConstructorTypeToError`, at the token after a "|" (`in_union`) or a "&". If a function or constructor type
    /// starts here, returns what to report after it has been skipped: where (its full start) and the code.
    #[cold]
    #[inline(never)]
    fn fn_type_after_operator_error(&mut self, in_union: bool) -> Option<(bun_ast::Loc, u32)> {
        // `isStartOfFunctionTypeOrConstructorType`
        let token = self.lexer.token;
        let is_constructor = match token {
            T::TLessThan => false,
            T::TOpenParen if self.is_unambiguously_start_of_function_type() => false,
            T::TNew => true,
            T::TIdentifier
                if self.lexer.is_contextual_keyword(b"abstract")
                    && self.next_token_matches(|p| p.lexer.token == T::TNew) =>
            {
                true
            }
            _ => return None,
        };
        let code = match (is_constructor, in_union) {
            (false, true) => 1385,
            (true, true) => 1386,
            (false, false) => 1387,
            (true, false) => 1388,
        };
        Some((self.lexer.full_start(), code))
    }

    // Rust cannot express a const-generic-dependent param type on stable; we use
    // `Option<&mut Metadata>` and require callers to pass `Some` iff `GET_METADATA == true`.
    // The const generic is kept so `if GET_METADATA { ... }` branches monomorphize away.
    pub(crate) fn skip_type_script_type_with_opts<const GET_METADATA: bool>(
        &mut self,
        level: Level,
        opts: SkipTypeOptionsBitset,
        result: Option<&mut Metadata>,
    ) -> Result<(), Error> {
        self.skip_type_script_type_impl::<GET_METADATA, false>(level, opts, result)
    }

    /// `parseTypeOperator` leaves DisallowConditionalTypesContext as it finds it, so that an "infer" right after "keyof" or "readonly"
    /// in an "extends" type keeps its constraint.
    #[inline]
    fn type_operand_opts(&self, opts: SkipTypeOptionsBitset) -> SkipTypeOptionsBitset {
        if opts.contains(SkipTypeOptions::DisallowConditionalTypes) && self.lexer.tolerant {
            SkipTypeOptionsBitset::only(SkipTypeOptions::DisallowConditionalTypes)
        } else {
            SkipTypeOptionsBitset::empty()
        }
    }

    /// A reserved word that is not among those `isStartOfType` lists. It names a type where there must be one (`parseTypeReference`),
    /// but is no element of a list of types (`isListElement`).
    #[inline]
    fn is_reserved_word_that_starts_no_type(&self) -> bool {
        self.lexer.token.is_reserved_word()
            && !matches!(
                self.lexer.token,
                T::TVoid
                    | T::TNull
                    | T::TThis
                    | T::TTypeof
                    | T::TNew
                    | T::TTrue
                    | T::TFalse
                    | T::TImport
                    | T::TFunction
            )
    }

    /// `createIdentifierWithDiagnostic(Type_expected)`: where a type must be and none starts, it is a reference to a type whose name is
    /// missing. The token stays.
    #[cold]
    #[inline(never)]
    fn missing_type(&mut self) -> Result<(), Error> {
        if self.should_keep_types() {
            let pos = self.token_start();
            self.emit_type_ref(StoreStr::EMPTY, pos);
        }
        // While only trying, nothing is said. If the trial succeeds, it is run again for its errors.
        if self.lexer.is_log_disabled {
            self.lexer.swallowed += 1;
            return Ok(());
        }
        // At the end of the file the error is where the token before ends.
        if self.lexer.token == T::TEndOfFile {
            let loc = self.lexer.full_start();
            self.lexer.ts_error(bun_ast::Range { loc, len: 0 }, 1110);
            return Ok(());
        }
        let (range, before) = (self.lexer.range(), self.lexer.prev_error_loc);
        self.lexer.ts_error(range, 1110);
        self.lexer.put_up_with(before)?;
        Ok(())
    }

    /// `parseTypeReference` at a token no other kind of type starts with. `parseEntityNameOfTypeReference`: a reserved word names a
    /// type like any other word, which is syntax TypeScript accepts, in its own trials too.
    #[cold]
    #[inline(never)]
    fn skip_type_reference_to_any_word(&mut self) -> Result<(), Error> {
        if !self.lexer.is_identifier_or_keyword() {
            return self.missing_type();
        }
        let keeps = self.should_keep_types();
        if keeps {
            let (name, pos) = (self.token_text(), self.token_start());
            self.emit_type_ref(name, pos);
        }
        self.lexer.next()?;
        // `parseTypeArgumentsOfTypeReference`
        if !self.lexer.has_newline_before {
            let reference = if keeps {
                self.last_type()
            } else {
                TypeId::NONE
            };
            let has_arguments = self.skip_type_script_type_arguments::<false, false>()?;
            if keeps {
                self.attach_type_args(reference, has_arguments);
            }
        }
        Ok(())
    }

    /// `parseEntityName`, `parseRightSideOfDot`: after a dot that no word follows.
    #[cold]
    #[inline(never)]
    fn skip_missing_name_after_dot<const KEEP: bool>(&mut self) -> Result<(), Error> {
        let mut reference = TypeId::NONE;
        let mut jsdoc_dot = None;
        match self.lexer.token {
            // "A.<T>": the name ends before the dot, and the type arguments are its own.
            T::TLessThan => {
                if KEEP {
                    reference = self.last_type();
                }
                jsdoc_dot = Some(bun_ast::Loc {
                    start: self.lexer.full_start().start - 1,
                });
            }
            // A private name is taken, and the name is said to be missing after it.
            T::TPrivateIdentifier => {
                let after = bun_ast::Range {
                    loc: bun_ast::usize2loc(self.lexer.end),
                    len: 0,
                };
                self.lexer.next()?;
                self.lexer.ts_error(after, 1003);
            }
            // The token stays.
            _ => self.lexer.expect(T::TIdentifier)?,
        }
        // `parseTypeArgumentsOfTypeReference`
        let has_arguments = !self.lexer.has_newline_before
            && self.skip_type_script_type_arguments::<false, false>()?;
        if has_arguments && let Some(loc) = jsdoc_dot {
            // `checkTypeReferenceNode`
            self.lexer
                .ts_grammar_error(bun_ast::Range { loc, len: 1 }, 8020);
        }
        if KEEP {
            self.attach_type_args(reference, has_arguments);
        }
        Ok(())
    }

    /// `parseRightSideOfDot`, at the first token of the line after a dot: two words on one line start something else, so the name
    /// is reported as missing (1003) right after the dot, and the token stays.
    #[cold]
    #[inline(never)]
    fn is_name_after_dot_missing(&mut self) -> bool {
        let is_word =
            |p: &Self| p.lexer.is_identifier_or_keyword() || p.lexer.token == T::TPrivateIdentifier;
        if !is_word(self) || !self.next_token_matches(|p| is_word(p) && !p.lexer.has_newline_before)
        {
            return false;
        }
        let after_dot = bun_ast::Range {
            loc: self.lexer.full_start(),
            len: 0,
        };
        self.lexer.ts_error(after_dot, 1003);
        true
    }

    /// `parseImportType`, after the comma that follows the specifier: "{ with: { name: value } }". What is missing is reported and
    /// the token stays, so the ")" and the qualifier are not found either. Returns the resolution mode
    /// (`getResolutionModeOverride`), and where "assert" is written instead of "with".
    #[cold]
    #[inline(never)]
    fn skip_import_type_attributes(
        &mut self,
    ) -> Result<(ResolutionMode, Option<bun_ast::Loc>), Error> {
        let open_brace = self.lexer.loc();
        self.lexer.expect(T::TOpenBrace)?;
        let mut assert_keyword_loc = None;
        if self.lexer.token == T::TWith {
            self.lexer.next()?;
        } else if self.lexer.is_contextual_keyword(b"assert") {
            // Reported when the type is cloned (2880).
            assert_keyword_loc = Some(self.lexer.loc());
            self.lexer.next()?;
        } else if self.lexer.is_log_disabled {
            return Err(crate::Error::Backtrack);
        } else {
            // 'with' expected.
            let (range, before) = (self.lexer.range(), self.lexer.prev_error_loc);
            self.lexer.ts_expected(range, "with");
            self.lexer.put_up_with(before)?;
        }
        self.lexer.expect(T::TColon)?;

        // `parseImportAttributes`
        let mut mode = ResolutionMode::None;
        let mut count = 0u32;
        if self.lexer.token != T::TOpenBrace {
            // Reported, and there are no attributes.
            self.lexer.expect(T::TOpenBrace)?;
        } else {
            let attributes_open_brace = self.lexer.loc();
            self.lexer.next()?;
            let saved_contexts = self.enter_list(ListKind::ImportAttributes);
            while self.lexer.token != T::TCloseBrace {
                match self.classify_list_token(ListKind::ImportAttributes)? {
                    ListStep::Element => {}
                    ListStep::Skipped => continue,
                    ListStep::Over => break,
                }
                // A speculative parse, which classifies nothing, fails here.
                if !self.lexer.is_identifier_or_keyword()
                    && !matches!(self.lexer.token, T::TStringLiteral | T::TPrivateIdentifier)
                {
                    return Err(crate::Error::Backtrack);
                }

                // `parseImportAttribute`
                let element_start = self.lexer.loc();
                let is_resolution_mode = self.lexer.token == T::TStringLiteral
                    && self
                        .string_token_text()
                        .is_some_and(|name| &*name == b"resolution-mode");
                self.lexer.next()?;
                self.lexer.expect(T::TColon)?;
                let text = if self.lexer.token == T::TStringLiteral {
                    self.string_token_text()
                } else {
                    None
                };
                let value = self.parse_detached(|p| p.parse_expr(Level::Comma))?;
                count += 1;
                mode = match text {
                    Some(text)
                        if count == 1
                            && is_resolution_mode
                            && matches!(value.data, bun_ast::ExprData::EString(_)) =>
                    {
                        match &*text {
                            b"import" => ResolutionMode::Import,
                            b"require" => ResolutionMode::Require,
                            _ => ResolutionMode::None,
                        }
                    }
                    _ => ResolutionMode::None,
                };

                if self.lexer.token != T::TComma {
                    if self.recover_missing_comma(ListKind::ImportAttributes, element_start)? {
                        continue;
                    }
                    break;
                }
                self.lexer.next()?;
            }
            self.lexer.list_contexts = saved_contexts;
            self.lexer
                .expect_close_brace_of_attributes(attributes_open_brace)?;
        }

        if self.lexer.token == T::TComma {
            self.lexer.next()?;
        }
        self.lexer.expect_close_brace_of_attributes(open_brace)?;
        Ok((mode, assert_keyword_loc))
    }

    /// `nextIsStartOfType`
    #[cold]
    #[inline(never)]
    fn next_token_starts_a_type(&mut self) -> bool {
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let result = self.lexer.next().is_ok() && self.is_start_of_type(false);
        self.lexer.restore(&old_lexer);
        result
    }

    /// `parseJSDocNullableType`, `parseJSDocNonNullableType`, `parseJSDocAllType`, at a "?", "??", "!", "*" or "*=" where a type
    /// starts. TypeScript's parser takes them, and its checker objects (17020, 8020).
    #[cold]
    #[inline(never)]
    fn skip_jsdoc_prefix_type<const KEEP: bool>(
        &mut self,
        opts: SkipTypeOptionsBitset,
    ) -> Result<(), Error> {
        let (token, pos) = (self.lexer.token, self.token_start());
        match token {
            // `ReScanQuestionToken`, `ReScanAsteriskEqualsToken`: only the first character is taken.
            T::TQuestionQuestion => {
                self.lexer.token = T::TQuestion;
                self.lexer.start += 1;
            }
            T::TAsteriskEquals => {
                self.lexer.token = T::TEquals;
                self.lexer.start += 1;
            }
            _ => self.lexer.next()?,
        }
        if matches!(token, T::TAsterisk | T::TAsteriskEquals) {
            if KEEP {
                self.emit_type(TypeData::JsDocAll, pos);
            }
            return Ok(());
        }
        // `parseTypeOperatorOrHigher`
        let operand_opts = self.type_operand_opts(opts);
        self.skip_nested_type::<KEEP>(Level::Prefix, operand_opts)?;
        if KEEP {
            self.emit_jsdoc_type(token != T::TExclamation, false, pos);
        }
        Ok(())
    }

    /// `scanStartOfNamedTupleElement`
    #[cold]
    #[inline(never)]
    fn is_start_of_named_tuple_element(&mut self) -> bool {
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let result = (self.lexer.token != T::TDotDotDot || self.lexer.next().is_ok())
            && self.lexer.is_identifier_or_keyword()
            && self.lexer.next().is_ok()
            // `nextTokenIsColonOrQuestionColon`
            && (self.lexer.token == T::TColon
                || self.lexer.token == T::TQuestion
                    && self.lexer.next().is_ok()
                    && self.lexer.token == T::TColon);
        self.lexer.restore(&old_lexer);
        result
    }

    /// `parseTupleType` in tolerant mode: the elements, up to where the "]" must be.
    #[cold]
    #[inline(never)]
    fn skip_tuple_elements<const KEEP: bool>(
        &mut self,
        elements: &mut Vec<TupleElement>,
    ) -> Result<(), Error> {
        let saved_contexts = self.enter_list(ListKind::TupleElementTypes);
        while self.lexer.token != T::TCloseBracket {
            if self.lexer.is_log_disabled {
                // A speculative parse fails at the "]" that is not there.
                if !self.is_list_element(ListKind::TupleElementTypes, false) {
                    break;
                }
            } else {
                match self.classify_list_token(ListKind::TupleElementTypes)? {
                    ListStep::Element => {}
                    ListStep::Skipped => continue,
                    ListStep::Over => break,
                }
            }
            let element_start = self.lexer.loc();
            let element = self.skip_tuple_element::<KEEP>()?;
            if KEEP {
                elements.push(element);
            }
            if self.lexer.token != T::TComma {
                if self.recover_missing_comma(ListKind::TupleElementTypes, element_start)? {
                    continue;
                }
                break;
            }
            self.lexer.next()?;
        }
        self.lexer.list_contexts = saved_contexts;
        Ok(())
    }

    /// `parseTupleElementNameOrTupleElementType`
    fn skip_tuple_element<const KEEP: bool>(&mut self) -> Result<TupleElement, Error> {
        let mut element = TupleElement {
            ty: TypeId::NONE,
            label: None,
            is_optional: false,
            is_rest: false,
            loc: self.lexer.loc(),
        };
        let is_named = self.is_start_of_named_tuple_element();
        if is_named {
            if self.lexer.token == T::TDotDotDot {
                element.is_rest = true;
                self.lexer.next()?;
            }
            element.label = Some(self.token_text());
            self.lexer.next()?;
            if self.lexer.token == T::TQuestion {
                element.is_optional = true;
                self.lexer.next()?;
            }
            self.lexer.expect(T::TColon)?;
        }
        // `parseTupleElementType`
        let type_loc = self.lexer.loc();
        let has_dots = self.lexer.token == T::TDotDotDot;
        if has_dots {
            self.lexer.next()?;
        }
        self.skip_nested_type::<KEEP>(Level::Lowest, SkipTypeOptionsBitset::empty())?;
        if KEEP {
            let pos = type_loc.start.max(0) as u32;
            if has_dots {
                // "label: ...T" is for the checker to object to (5087).
                if is_named {
                    let ty = self.last_type();
                    self.emit_type_if_complete(&[ty], TypeData::Rest(ty), pos);
                } else {
                    element.is_rest = true;
                }
            } else if let Some(ty) = self.optional_tuple_element_type(type_loc) {
                // "label: T?" is for the checker to object to (5086).
                if is_named {
                    self.emit_type(TypeData::Optional(ty), pos);
                } else {
                    element.is_optional = true;
                    self.type_syntax_mut().last_type = ty;
                }
            }
            element.ty = self.last_type();
        }
        Ok(element)
    }

    fn skip_type_script_type_impl<const GET_METADATA: bool, const KEEP: bool>(
        &mut self,
        level: Level,
        opts: SkipTypeOptionsBitset,
        mut result: Option<&mut Metadata>,
    ) -> Result<(), Error> {
        self.mark_type_script_only();

        // Deeply nested types ("[[[[...", "A<A<A<...", ...) recurse through this
        // function, so bound it the same way `parse_expr_common` bounds expression
        // recursion instead of overflowing the stack.
        if !self.stack_check.is_safe_to_recurse() {
            return Err(crate::Error::StackOverflow);
        }

        // The "|" or "&" skipped ahead of the type; of "| &", the "&".
        let mut leading_operator: Option<T> = None;
        // What to report once the function type that starts right after a "|" or "&" has been skipped. Tolerant mode only.
        let mut fn_type_error: Option<(bun_ast::Loc, u32)> = None;

        // Start offsets of the whole type, of its first intersection, and of the current operand.
        let start = if KEEP { self.token_start() } else { 0 };
        let mut intersection_start = start;
        let mut pos = start;
        // Index into `TypeSyntax::type_stack` where the pending union and intersection start. `usize::MAX` if there is none.
        let mut union_base = usize::MAX;
        let mut intersection_base = usize::MAX;
        // Saw "abstract" directly before "new".
        let mut is_abstract = false;
        // Offset of the "typeof" directly before "import".
        let mut typeof_pos = None;
        // The type starts with "(". Parentheses have no node.
        let mut is_parenthesized = false;
        // Returns from the function, closing any pending union or intersection first.
        macro_rules! finish {
            () => {{
                if KEEP {
                    self.finish_union_and_intersection(
                        &mut intersection_base,
                        intersection_start,
                        &mut union_base,
                        start,
                    );
                }
                return Ok(());
            }};
        }

        loop {
            if KEEP {
                pos = self.token_start();
                self.emit_single_token_type();
            }
            match self.lexer.token {
                T::TNumericLiteral => {
                    self.lexer.next()?;
                    if GET_METADATA {
                        **result
                            .as_mut()
                            .expect("infallible: GET_METADATA implies Some") = Metadata::MNumber;
                    }
                }
                T::TBigIntegerLiteral => {
                    self.lexer.next()?;
                    if GET_METADATA {
                        **result
                            .as_mut()
                            .expect("infallible: GET_METADATA implies Some") = Metadata::MBigint;
                    }
                }
                T::TStringLiteral | T::TNoSubstitutionTemplateLiteral => {
                    self.lexer.next()?;
                    if GET_METADATA {
                        **result
                            .as_mut()
                            .expect("infallible: GET_METADATA implies Some") = Metadata::MString;
                    }
                }
                T::TTrue | T::TFalse => {
                    self.lexer.next()?;
                    if GET_METADATA {
                        **result
                            .as_mut()
                            .expect("infallible: GET_METADATA implies Some") = Metadata::MBoolean;
                    }
                }
                T::TNull => {
                    self.lexer.next()?;
                    if GET_METADATA {
                        **result
                            .as_mut()
                            .expect("infallible: GET_METADATA implies Some") = Metadata::MNull;
                    }
                }
                T::TVoid => {
                    self.lexer.next()?;
                    if GET_METADATA {
                        **result
                            .as_mut()
                            .expect("infallible: GET_METADATA implies Some") = Metadata::MVoid;
                    }
                }
                T::TConst => {
                    // `isListElement(PCTupleElementTypes)`: no element of a tuple starts with it.
                    if is_at_start_of(
                        SkipTypeOptions::AllowTupleLabels,
                        opts,
                        level,
                        leading_operator,
                    ) && self.lexer.tolerant
                    {
                        return self.missing_type();
                    }

                    let r = self.lexer.range();
                    self.lexer.next()?;

                    // ["const: number]"
                    if opts.contains(SkipTypeOptions::AllowTupleLabels)
                        && self.lexer.token == T::TColon
                    {
                        self.log()
                            .add_range_error(Some(self.source), r, b"Unexpected \"const\"");
                    }
                }

                T::TThis => {
                    self.lexer.next()?;

                    // "function check(): this is boolean"
                    if self.lexer.is_contextual_keyword(b"is") && !self.lexer.has_newline_before {
                        self.lexer.next()?;
                        if KEEP {
                            self.skip_nested_type::<true>(
                                Level::Lowest,
                                SkipTypeOptionsBitset::empty(),
                            )?;
                            self.emit_type_predicate(StoreStr::new(b"this"), false, pos);
                            return Ok(());
                        }
                        self.skip_type_script_type(Level::Lowest)?;
                        return Ok(());
                    }

                    if GET_METADATA {
                        **result
                            .as_mut()
                            .expect("infallible: GET_METADATA implies Some") = Metadata::MObject;
                    }
                }
                T::TMinus => {
                    // `parseNonArrayType`: a type only if a number comes next.
                    if self.lexer.tolerant
                        && !opts.contains(SkipTypeOptions::IsIndexSignature)
                        && !self.next_token_matches(|p| {
                            matches!(p.lexer.token, T::TNumericLiteral | T::TBigIntegerLiteral)
                        })
                    {
                        self.missing_type()?;
                        break;
                    }

                    // "-123"
                    // "-123n"
                    self.lexer.next()?;
                    if KEEP {
                        self.emit_negative_literal_type(pos);
                    }

                    if self.lexer.token == T::TBigIntegerLiteral {
                        self.lexer.next()?;
                        if GET_METADATA {
                            **result
                                .as_mut()
                                .expect("infallible: GET_METADATA implies Some") =
                                Metadata::MBigint;
                        }
                    } else {
                        self.lexer.expect(T::TNumericLiteral)?;
                        if GET_METADATA {
                            **result
                                .as_mut()
                                .expect("infallible: GET_METADATA implies Some") =
                                Metadata::MNumber;
                        }
                    }
                }
                T::TAmpersand | T::TBar => {
                    // `parseUnionOrIntersectionType`: one "|" may lead a union, and one "&" each of the intersections in it.
                    // Any other stands where a type is missing, and is the operator after it.
                    let is_operator_after_nothing = if self.lexer.token == T::TBar {
                        leading_operator.is_some() || level.gte(Level::BitwiseOr)
                    } else {
                        leading_operator == Some(T::TAmpersand) || level.gte(Level::BitwiseAnd)
                    };
                    if is_operator_after_nothing && self.lexer.tolerant {
                        self.missing_type()?;
                        break;
                    }

                    // Support things like "type Foo = | A | B" and "type Foo = & A & B"
                    leading_operator = Some(self.lexer.token);
                    self.lexer.next()?;
                    if self.lexer.tolerant {
                        fn_type_error =
                            self.fn_type_after_operator_error(leading_operator == Some(T::TBar));
                    }
                    if KEEP && leading_operator == Some(T::TBar) {
                        intersection_start = self.token_start();
                    }
                    continue;
                }
                T::TImport => {
                    // "import('fs')"
                    self.lexer.next()?;

                    // "[import: number]"
                    // "[import?: number]"
                    if opts.contains(SkipTypeOptions::AllowTupleLabels)
                        && (self.lexer.token == T::TColon || self.lexer.token == T::TQuestion)
                    {
                        return Ok(());
                    }

                    self.lexer.expect(T::TOpenParen)?;
                    let specifier = if KEEP {
                        self.import_type_specifier()
                    } else {
                        None
                    };
                    let mut argument = TypeId::NONE;
                    if self.lexer.token != T::TStringLiteral && self.lexer.tolerant {
                        // `parseImportType`: any type. The checker objects to it (1141).
                        self.skip_nested_type::<KEEP>(
                            Level::Lowest,
                            SkipTypeOptionsBitset::empty(),
                        )?;
                        if KEEP {
                            argument = self.last_type();
                        }
                    } else {
                        self.lexer.expect(T::TStringLiteral)?;
                    }

                    // "import('./foo.json', { assert: { type: 'json' } })"
                    // "import('./foo.json', { with: { type: 'json' } })"
                    let mut attributes = Some((ResolutionMode::None, None));
                    if self.lexer.token == T::TComma && self.lexer.tolerant {
                        self.lexer.next()?;
                        attributes = Some(self.skip_import_type_attributes()?);
                    } else if self.lexer.token == T::TComma {
                        self.lexer.next()?;
                        self.skip_type_script_object_type()?;
                        if KEEP {
                            attributes = self.import_type_attributes();
                        }

                        // "import('./foo.json', { assert: { type: 'json' } }, )"
                        // "import('./foo.json', { with: { type: 'json' } }, )"
                        if self.lexer.token == T::TComma {
                            self.lexer.next()?;
                        }
                    }

                    self.lexer.expect(T::TCloseParen)?;
                    if KEEP {
                        // What follows, such as "[K]", applies to all of "typeof import(..)".
                        let is_typeof = typeof_pos.is_some();
                        pos = typeof_pos.take().unwrap_or(pos);
                        self.emit_import_type(specifier, argument, attributes, is_typeof, pos);
                    }
                    // "import('./foo')<T>" (`parseImportType`). Ordinary builds reject this.
                    if self.lexer.tolerant && !self.lexer.has_newline_before {
                        let reference = if KEEP { self.last_type() } else { TypeId::NONE };
                        let has_arguments =
                            self.skip_type_script_type_arguments::<false, false>()?;
                        if KEEP {
                            self.attach_type_args(reference, has_arguments);
                        }
                    }
                }
                T::TNew => {
                    // "new () => Foo"
                    // "new <T>() => Foo<T>"
                    self.lexer.next()?;

                    // "[new: number]"
                    // "[new?: number]"
                    if opts.contains(SkipTypeOptions::AllowTupleLabels)
                        && (self.lexer.token == T::TColon || self.lexer.token == T::TQuestion)
                    {
                        return Ok(());
                    }

                    let fn_type_start = if KEEP { self.token_start() } else { 0 };
                    let type_parameters = self.skip_type_script_type_parameters(
                        TypeParameterFlag::ALLOW_CONST_MODIFIER,
                    )?;
                    if KEEP {
                        let flags = if is_abstract {
                            Flags::ABSTRACT
                        } else {
                            Flags::empty()
                        };
                        self.set_fn_type_head(
                            SignatureKind::ConstructorType,
                            flags,
                            type_parameters,
                            fn_type_start,
                        );
                    }
                    self.skip_type_script_paren_or_fn_type::<GET_METADATA, KEEP>(
                        result.as_deref_mut(),
                    )?;
                }
                T::TLessThan => {
                    // "<T>() => Foo<T>"
                    let type_parameters = self.skip_type_script_type_parameters(
                        TypeParameterFlag::ALLOW_CONST_MODIFIER,
                    )?;
                    if KEEP {
                        self.set_fn_type_head(
                            SignatureKind::FunctionType,
                            Flags::empty(),
                            type_parameters,
                            pos,
                        );
                    }
                    self.skip_type_script_paren_or_fn_type::<GET_METADATA, KEEP>(
                        result.as_deref_mut(),
                    )?;
                }
                T::TOpenParen => {
                    // "(number | string)"
                    self.skip_type_script_paren_or_fn_type::<GET_METADATA, KEEP>(
                        result.as_deref_mut(),
                    )?;
                    if KEEP {
                        is_parenthesized = true;
                    }
                }
                T::TIdentifier => {
                    let kind =
                        kind_for_identifier(self.lexer.identifier).unwrap_or(TsIdentKind::Normal);

                    let mut check_type_parameters = true;
                    // "asserts x": the "x" was skipped as well.
                    let mut asserts_name = false;
                    // The subject of a type predicate: this identifier, or the one after "asserts".
                    let mut predicate_subject = if KEEP {
                        StoreStr::new(self.lexer.identifier)
                    } else {
                        StoreStr::EMPTY
                    };

                    match kind {
                        // `parseTypeOrTypePredicate` goes before `parseType`: in "(keyof): keyof is T" the word is the parameter.
                        TsIdentKind::PrefixKeyof
                        | TsIdentKind::PrefixReadonly
                        | TsIdentKind::Infer
                        | TsIdentKind::Unique
                        | TsIdentKind::Asserts
                            if is_at_start_of(
                                SkipTypeOptions::IsReturnType,
                                opts,
                                level,
                                leading_operator,
                            ) && self.lexer.tolerant
                                && self.next_token_matches(|p| {
                                    p.lexer.is_contextual_keyword(b"is")
                                        && !p.lexer.has_newline_before
                                }) =>
                        {
                            self.lexer.next()?;
                        }
                        TsIdentKind::PrefixKeyof => {
                            self.lexer.next()?;

                            // Valid:
                            //   "[keyof: string]"
                            //   "[keyof?: string]"
                            //   "{[keyof: string]: number}"
                            //   "{[keyof in string]: number}"
                            //
                            // Invalid:
                            //   "A extends B ? keyof : string"
                            //
                            if (self.lexer.token != T::TColon
                                && self.lexer.token != T::TQuestion
                                && self.lexer.token != T::TIn)
                                || (!opts.contains(SkipTypeOptions::IsIndexSignature)
                                    && !opts.contains(SkipTypeOptions::AllowTupleLabels))
                            {
                                let operand_opts = self.type_operand_opts(opts);
                                self.skip_nested_type::<KEEP>(Level::Prefix, operand_opts)?;
                                if KEEP {
                                    let ty = self.last_type();
                                    self.emit_type_if_complete(&[ty], TypeData::Keyof(ty), pos);
                                }
                            }

                            if GET_METADATA {
                                **result
                                    .as_mut()
                                    .expect("infallible: GET_METADATA implies Some") =
                                    Metadata::MObject;
                            }

                            break;
                        }
                        TsIdentKind::PrefixReadonly => {
                            self.lexer.next()?;

                            if (self.lexer.token != T::TColon
                                && self.lexer.token != T::TQuestion
                                && self.lexer.token != T::TIn)
                                || (!opts.contains(SkipTypeOptions::IsIndexSignature)
                                    && !opts.contains(SkipTypeOptions::AllowTupleLabels))
                            {
                                let operand_opts = self.type_operand_opts(opts);
                                self.skip_type_script_type_impl::<false, KEEP>(
                                    Level::Prefix,
                                    operand_opts,
                                    None,
                                )?;
                                if KEEP {
                                    let ty = self.last_type();
                                    self.emit_type_if_complete(&[ty], TypeData::Readonly(ty), pos);
                                }
                            }

                            // assume array or tuple literal
                            if GET_METADATA {
                                **result
                                    .as_mut()
                                    .expect("infallible: GET_METADATA implies Some") =
                                    Metadata::MArray;
                            }

                            break;
                        }
                        TsIdentKind::Infer => {
                            self.lexer.next()?;

                            // "type Foo = Bar extends [infer T] ? T : null"
                            // "type Foo = Bar extends [infer T extends string] ? T : null"
                            // "type Foo = Bar extends [infer T extends string ? infer T : never] ? T : null"
                            // "type Foo = { [infer in Bar]: number }"
                            // "type Foo = [infer?: number]"
                            if (self.lexer.token != T::TColon
                                && self.lexer.token != T::TQuestion
                                && self.lexer.token != T::TIn)
                                || (!opts.contains(SkipTypeOptions::IsIndexSignature)
                                    && !opts.contains(SkipTypeOptions::AllowTupleLabels))
                            {
                                let (name, name_pos) = if KEEP {
                                    (StoreStr::new(self.lexer.identifier), self.token_start())
                                } else {
                                    (StoreStr::EMPTY, 0)
                                };
                                self.lexer.expect(T::TIdentifier)?;
                                let mut has_constraint = false;
                                if self.lexer.token == T::TExtends {
                                    has_constraint = self
                                        .try_skip_type_script_constraint_of_infer_type_with_backtracking(
                                            opts,
                                        );
                                }
                                if KEEP {
                                    self.emit_infer_type(name, name_pos, has_constraint, pos);
                                }
                            }

                            break;
                        }
                        TsIdentKind::Unique => {
                            self.lexer.next()?;

                            // "let foo: unique symbol"
                            if self.lexer.is_contextual_keyword(b"symbol") {
                                self.lexer.next()?;
                                if KEEP {
                                    self.emit_type(TypeData::UniqueSymbol, pos);
                                }
                                break;
                            }
                            // `parseTypeOperator`: "unique" is an operator whatever follows, like "keyof".
                            if self.lexer.tolerant
                                && ((self.lexer.token != T::TColon
                                    && self.lexer.token != T::TQuestion
                                    && self.lexer.token != T::TIn)
                                    || (!opts.contains(SkipTypeOptions::IsIndexSignature)
                                        && !opts.contains(SkipTypeOptions::AllowTupleLabels)))
                            {
                                let operand = self.lexer.range();
                                let operand_opts = self.type_operand_opts(opts);
                                self.skip_nested_type::<KEEP>(Level::Prefix, operand_opts)?;
                                // `checkGrammarTypeOperatorNode`: 'symbol' expected.
                                self.lexer.ts_grammar_expected(operand, "symbol");
                                if KEEP {
                                    let ty = self.last_type();
                                    self.emit_type_if_complete(
                                        &[ty],
                                        TypeData::UniqueOperator(ty),
                                        pos,
                                    );
                                }
                                break;
                            }
                            if KEEP {
                                self.emit_type_ref(predicate_subject, pos);
                            }
                        }
                        TsIdentKind::Abstract => {
                            self.lexer.next()?;

                            // "let foo: abstract new () => {}" added in TypeScript 4.2
                            if self.lexer.token == T::TNew {
                                is_abstract = true;
                                continue;
                            }
                            if KEEP {
                                self.emit_type_ref(predicate_subject, pos);
                            }
                        }
                        TsIdentKind::Asserts => {
                            self.lexer.next()?;

                            // "function assert(x: boolean): asserts x"
                            // "function assert(x: boolean): asserts x is boolean"
                            // TypeScript's parser (`parseNonArrayType`) accepts this in any type position and leaves the error to the
                            // checker, so tolerant mode does the same.
                            if (opts.contains(SkipTypeOptions::IsReturnType) || self.lexer.tolerant)
                                && !self.lexer.has_newline_before
                                && (self.lexer.token == T::TIdentifier
                                    || self.lexer.token == T::TThis)
                            {
                                if KEEP {
                                    predicate_subject = if self.lexer.token == T::TThis {
                                        StoreStr::new(b"this")
                                    } else {
                                        StoreStr::new(self.lexer.identifier)
                                    };
                                    self.emit_predicate_of(
                                        predicate_subject,
                                        TypeId::NONE,
                                        true,
                                        pos,
                                    );
                                }
                                self.lexer.next()?;
                                asserts_name = true;
                            } else if KEEP {
                                self.emit_type_ref(predicate_subject, pos);
                            }
                        }
                        TsIdentKind::PrimitiveAny => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result
                                    .as_mut()
                                    .expect("infallible: GET_METADATA implies Some") =
                                    Metadata::MAny;
                            }
                        }
                        TsIdentKind::PrimitiveNever => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result
                                    .as_mut()
                                    .expect("infallible: GET_METADATA implies Some") =
                                    Metadata::MNever;
                            }
                        }
                        TsIdentKind::PrimitiveUnknown => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result
                                    .as_mut()
                                    .expect("infallible: GET_METADATA implies Some") =
                                    Metadata::MUnknown;
                            }
                        }
                        TsIdentKind::PrimitiveUndefined => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result
                                    .as_mut()
                                    .expect("infallible: GET_METADATA implies Some") =
                                    Metadata::MUndefined;
                            }
                        }
                        TsIdentKind::PrimitiveObject => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result
                                    .as_mut()
                                    .expect("infallible: GET_METADATA implies Some") =
                                    Metadata::MObject;
                            }
                        }
                        TsIdentKind::PrimitiveNumber => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result
                                    .as_mut()
                                    .expect("infallible: GET_METADATA implies Some") =
                                    Metadata::MNumber;
                            }
                        }
                        TsIdentKind::PrimitiveString => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result
                                    .as_mut()
                                    .expect("infallible: GET_METADATA implies Some") =
                                    Metadata::MString;
                            }
                        }
                        TsIdentKind::PrimitiveBoolean => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result
                                    .as_mut()
                                    .expect("infallible: GET_METADATA implies Some") =
                                    Metadata::MBoolean;
                            }
                        }
                        TsIdentKind::PrimitiveBigint => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result
                                    .as_mut()
                                    .expect("infallible: GET_METADATA implies Some") =
                                    Metadata::MBigint;
                            }
                        }
                        TsIdentKind::PrimitiveSymbol => {
                            self.lexer.next()?;
                            check_type_parameters = false;
                            if GET_METADATA {
                                **result
                                    .as_mut()
                                    .expect("infallible: GET_METADATA implies Some") =
                                    Metadata::MSymbol;
                            }
                        }
                        TsIdentKind::Normal => {
                            if GET_METADATA {
                                let ident = self.lexer.identifier;
                                let find_result = self.find_symbol(bun_ast::Loc::EMPTY, ident)?;
                                **result
                                    .as_mut()
                                    .expect("infallible: GET_METADATA implies Some") =
                                    Metadata::MIdentifier(find_result.r#ref);
                            }

                            self.lexer.next()?;
                        }
                    }

                    // "function assert(x: any): x is boolean"
                    if self.lexer.is_contextual_keyword(b"is")
                        && (if self.lexer.tolerant {
                            // `parseAssertsTypePredicate` takes the "is" after "asserts x" from whichever line.
                            // `parseTypeOrTypePredicate`: any other only follows, on its line, the first word of a return type.
                            asserts_name
                                || (!self.lexer.has_newline_before
                                    && is_at_start_of(
                                        SkipTypeOptions::IsReturnType,
                                        opts,
                                        level,
                                        leading_operator,
                                    ))
                        } else {
                            !self.lexer.has_newline_before
                        })
                    {
                        self.lexer.next()?;
                        if KEEP {
                            self.skip_nested_type::<true>(
                                Level::Lowest,
                                SkipTypeOptionsBitset::empty(),
                            )?;
                            self.emit_type_predicate(predicate_subject, asserts_name, pos);
                            return Ok(());
                        }
                        self.skip_type_script_type(Level::Lowest)?;
                        return Ok(());
                    }

                    // "let foo: any \n <number>foo" must not become a single type
                    if check_type_parameters && !self.lexer.has_newline_before {
                        if KEEP {
                            let reference = self.last_type();
                            let has_arguments =
                                self.skip_type_script_type_arguments::<false, false>()?;
                            self.attach_type_args(reference, has_arguments);
                        } else {
                            let _ = self.skip_type_script_type_arguments::<false, false>()?;
                        }
                    }
                }
                T::TTypeof => {
                    self.lexer.next()?;

                    // "[typeof: number]"
                    // "[typeof?: number]"
                    if opts.contains(SkipTypeOptions::AllowTupleLabels)
                        && (self.lexer.token == T::TColon || self.lexer.token == T::TQuestion)
                    {
                        return Ok(());
                    }

                    // always `Object`
                    if GET_METADATA {
                        **result
                            .as_mut()
                            .expect("infallible: GET_METADATA implies Some") = Metadata::MObject;
                    }

                    if self.lexer.token == T::TImport {
                        // "typeof import('fs')"
                        typeof_pos = Some(pos);
                        continue;
                    } else {
                        // "typeof x"
                        if !self.lexer.is_identifier_or_keyword() {
                            if self.lexer.tolerant {
                                // `parseEntityName`: the name is missing (1003), and the token stays.
                                self.lexer.expect(T::TIdentifier)?;
                                if KEEP {
                                    let name = Name {
                                        text: StoreStr::EMPTY,
                                        loc: self.lexer.full_start(),
                                    };
                                    let names = self.type_syntax_mut().name_stack.len();
                                    self.type_syntax_mut().name_stack.push(name);
                                    self.emit_typeof_type(names, false, pos);
                                }
                                break;
                            }
                            self.lexer.expected(T::TIdentifier)?;
                        }
                        let names = if KEEP {
                            self.type_syntax_mut().name_stack.len()
                        } else {
                            0
                        };
                        if KEEP {
                            self.push_typeof_name();
                        }
                        self.lexer.next()?;

                        // "typeof x.#y"
                        // "typeof x.y"
                        while self.lexer.token == T::TDot {
                            self.lexer.next()?;

                            if self.lexer.has_newline_before
                                && self.lexer.tolerant
                                && self.is_name_after_dot_missing()
                            {
                                if KEEP {
                                    let name = Name {
                                        text: StoreStr::EMPTY,
                                        loc: self.lexer.full_start(),
                                    };
                                    self.type_syntax_mut().name_stack.push(name);
                                }
                                break;
                            }
                            if !self.lexer.is_identifier_or_keyword()
                                && self.lexer.token != T::TPrivateIdentifier
                            {
                                if self.lexer.tolerant {
                                    // `parseRightSideOfDot`: the name is missing (1003), and the token stays.
                                    self.lexer.expect(T::TIdentifier)?;
                                    if KEEP {
                                        self.push_typeof_name();
                                    }
                                    break;
                                }
                                self.lexer.expected(T::TIdentifier)?;
                            }
                            if KEEP {
                                self.push_typeof_name();
                            }
                            self.lexer.next()?;
                        }

                        let mut has_arguments = false;
                        if !self.lexer.has_newline_before {
                            has_arguments =
                                self.skip_type_script_type_arguments::<false, false>()?;
                        }
                        if KEEP {
                            self.emit_typeof_type(names, has_arguments, pos);
                        }
                    }
                }
                T::TOpenBracket => {
                    // "[number, string]"
                    // "[first: number, second: string]"
                    self.lexer.next()?;

                    if GET_METADATA {
                        **result
                            .as_mut()
                            .expect("infallible: GET_METADATA implies Some") = Metadata::MArray;
                    }

                    let mut elements: Vec<TupleElement> = Vec::new();
                    while self.lexer.token != T::TCloseBracket {
                        if self.lexer.tolerant {
                            self.skip_tuple_elements::<KEEP>(&mut elements)?;
                            break;
                        }
                        let element_loc = self.lexer.loc();
                        let mut element_opts =
                            SkipTypeOptionsBitset::only(SkipTypeOptions::AllowTupleLabels);
                        let rest = self.lexer.token == T::TDotDotDot;
                        if self.lexer.token == T::TDotDotDot {
                            self.lexer.next()?;
                            // `scanStartOfNamedTupleElement`, `parseTupleElementType`: after "..." any word is a label or
                            // the name of a type.
                            if self.is_reserved_word_that_starts_no_type() && self.lexer.tolerant {
                                element_opts = SkipTypeOptionsBitset::empty();
                            }
                        }
                        // Used as the label if a ":" follows.
                        let word = (KEEP && self.lexer.is_identifier_or_keyword())
                            .then(|| self.token_text());
                        self.skip_nested_type::<KEEP>(Level::Lowest, element_opts)?;
                        let optional = self.lexer.token == T::TQuestion;
                        if self.lexer.token == T::TQuestion {
                            self.lexer.next()?;
                        }
                        let has_label = self.lexer.token == T::TColon;
                        if self.lexer.token == T::TColon {
                            self.lexer.next()?;
                            self.skip_nested_type::<KEEP>(
                                Level::Lowest,
                                SkipTypeOptionsBitset::empty(),
                            )?;
                        }
                        if KEEP {
                            elements.push(TupleElement {
                                ty: self.last_type(),
                                label: word.filter(|_| has_label),
                                is_optional: optional,
                                is_rest: rest,
                                loc: element_loc,
                            });
                        }
                        if self.lexer.token != T::TComma {
                            break;
                        }
                        self.lexer.next()?;
                    }
                    self.lexer.expect(T::TCloseBracket)?;
                    if KEEP {
                        self.emit_tuple_type(&elements, pos);
                    }
                }
                T::TOpenBrace => {
                    self.skip_type_script_object_type()?;
                    if KEEP {
                        self.emit_object_type(pos);
                    }
                    if GET_METADATA {
                        **result
                            .as_mut()
                            .expect("infallible: GET_METADATA implies Some") = Metadata::MObject;
                    }
                }
                T::TTemplateHead => {
                    // "`${'a' | 'b'}-${'c' | 'd'}`"
                    let mut texts: Vec<Option<StoreStr>> = Vec::new();
                    let mut types: Vec<TypeId> = Vec::new();
                    if KEEP {
                        texts.push(self.string_token_text());
                    }
                    loop {
                        self.lexer.next()?;
                        self.skip_nested_type::<KEEP>(
                            Level::Lowest,
                            SkipTypeOptionsBitset::empty(),
                        )?;
                        if KEEP {
                            types.push(self.last_type());
                        }
                        // `parseLiteralOfTemplateSpan`: without the "}" the template ends here, and the token stays.
                        if self.lexer.token != T::TCloseBrace && self.lexer.tolerant {
                            self.lexer.expect(T::TCloseBrace)?;
                            if KEEP {
                                types.push(TypeId::NONE);
                            }
                            break;
                        }
                        self.lexer.rescan_close_brace_as_template_token()?;
                        if KEEP {
                            texts.push(self.string_token_text());
                        }

                        if self.lexer.token == T::TTemplateTail {
                            self.lexer.next()?;
                            break;
                        }
                    }
                    if KEEP {
                        self.emit_template_type(&texts, &types, pos);
                    }
                    if GET_METADATA {
                        **result
                            .as_mut()
                            .expect("infallible: GET_METADATA implies Some") = Metadata::MString;
                    }
                }

                _ => {
                    // What is in the brackets of a type member is no type to TypeScript.
                    if self.lexer.tolerant && !opts.contains(SkipTypeOptions::IsIndexSignature) {
                        // `isListElement(PCTupleElementTypes)`: no element of a tuple starts with such a word, label or not.
                        if is_at_start_of(
                            SkipTypeOptions::AllowTupleLabels,
                            opts,
                            level,
                            leading_operator,
                        ) && self.is_reserved_word_that_starts_no_type()
                        {
                            return self.missing_type();
                        }
                        if matches!(
                            self.lexer.token,
                            T::TQuestion
                                | T::TQuestionQuestion
                                | T::TExclamation
                                | T::TAsterisk
                                | T::TAsteriskEquals
                        ) {
                            self.skip_jsdoc_prefix_type::<KEEP>(opts)?;
                            break;
                        }
                        self.skip_type_reference_to_any_word()?;
                        break;
                    }

                    // "[function: number]"
                    if opts.contains(SkipTypeOptions::AllowTupleLabels)
                        && self.lexer.is_identifier_or_keyword()
                    {
                        if self.lexer.token != T::TFunction {
                            self.lexer.unexpected()?;
                        }
                        self.lexer.next()?;

                        if self.lexer.token != T::TColon && self.lexer.token != T::TQuestion {
                            self.lexer.expect(T::TColon)?;
                        }

                        return Ok(());
                    }

                    self.lexer.unexpected()?;
                }
            }
            break;
        }
        if let Some((at, code)) = fn_type_error.take() {
            self.lexer
                .ts_error(bun_ast::Range { loc: at, len: 0 }, code);
        }

        loop {
            match self.lexer.token {
                T::TBar => {
                    if level.gte(Level::BitwiseOr) {
                        finish!();
                    }

                    self.lexer.next()?;
                    if self.lexer.tolerant {
                        fn_type_error = self.fn_type_after_operator_error(true);
                    }
                    if KEEP {
                        self.finish_intersection(&mut intersection_base, intersection_start);
                        self.begin_type_list(&mut union_base);
                    }

                    if GET_METADATA {
                        let mut left = (**result
                            .as_mut()
                            .expect("infallible: GET_METADATA implies Some"))
                        .clone();
                        if let Some(final_) =
                            Metadata::finish_union(&mut left, |r| self.load_name_from_ref(r))
                        {
                            // finish skipping the rest of the type without collecting type metadata.
                            **result
                                .as_mut()
                                .expect("infallible: GET_METADATA implies Some") = final_;
                            self.skip_type_script_type_impl::<false, KEEP>(
                                Level::BitwiseOr,
                                opts,
                                None,
                            )?;
                        } else {
                            self.skip_type_script_type_impl::<GET_METADATA, KEEP>(
                                Level::BitwiseOr,
                                opts,
                                result.as_deref_mut(),
                            )?;
                            Metadata::merge_union(
                                result
                                    .as_deref_mut()
                                    .expect("infallible: GET_METADATA implies Some"),
                                left,
                            );
                        }
                    } else {
                        self.skip_type_script_type_impl::<false, KEEP>(
                            Level::BitwiseOr,
                            opts,
                            None,
                        )?;
                    }
                    if let Some((at, code)) = fn_type_error.take() {
                        self.lexer
                            .ts_error(bun_ast::Range { loc: at, len: 0 }, code);
                    }
                    if KEEP {
                        self.push_type_list_item();
                    }
                }
                T::TAmpersand => {
                    if level.gte(Level::BitwiseAnd) {
                        finish!();
                    }

                    self.lexer.next()?;
                    if self.lexer.tolerant {
                        fn_type_error = self.fn_type_after_operator_error(false);
                    }
                    if KEEP {
                        self.begin_type_list(&mut intersection_base);
                    }

                    if GET_METADATA {
                        let mut left = (**result
                            .as_mut()
                            .expect("infallible: GET_METADATA implies Some"))
                        .clone();
                        if let Some(final_) =
                            Metadata::finish_intersection(&mut left, |r| self.load_name_from_ref(r))
                        {
                            // finish skipping the rest of the type without collecting type metadata.
                            **result
                                .as_mut()
                                .expect("infallible: GET_METADATA implies Some") = final_;
                            self.skip_type_script_type_impl::<false, KEEP>(
                                Level::BitwiseAnd,
                                opts,
                                None,
                            )?;
                        } else {
                            self.skip_type_script_type_impl::<GET_METADATA, KEEP>(
                                Level::BitwiseAnd,
                                opts,
                                result.as_deref_mut(),
                            )?;
                            Metadata::merge_intersection(
                                result
                                    .as_deref_mut()
                                    .expect("infallible: GET_METADATA implies Some"),
                                left,
                            );
                        }
                    } else {
                        self.skip_type_script_type_impl::<false, KEEP>(
                            Level::BitwiseAnd,
                            opts,
                            None,
                        )?;
                    }
                    if let Some((at, code)) = fn_type_error.take() {
                        self.lexer
                            .ts_error(bun_ast::Range { loc: at, len: 0 }, code);
                    }
                    if KEEP {
                        self.push_type_list_item();
                    }
                }
                T::TExclamation => {
                    // A postfix "!" is allowed in JSDoc types in TypeScript, which are only
                    // present in comments. While it's not valid in a non-comment position,
                    // it's still parsed and turned into a soft error by the TypeScript
                    // compiler. It turns out parsing this is important for correctness for
                    // "as" casts because the "!" token must still be consumed.
                    if self.lexer.has_newline_before {
                        finish!();
                    }

                    self.lexer.next()?;
                    if KEEP {
                        self.emit_jsdoc_type(false, true, pos);
                    }
                }
                T::TQuestion => {
                    // `parsePostfixTypeOrHigher`: JSDoc's "T?", unless a type comes next, which makes it the "?" of a conditional
                    // type. The checker objects to it (17019).
                    if !self.lexer.tolerant
                        || self.lexer.has_newline_before
                        || opts.contains(SkipTypeOptions::IsIndexSignature)
                        || self.next_token_starts_a_type()
                    {
                        finish!();
                    }

                    self.lexer.next()?;
                    if KEEP {
                        self.emit_jsdoc_type(true, true, pos);
                    }
                }
                T::TDot => {
                    // `parseEntityName`: a dot only goes on from a name. After any other type it is somebody else's token.
                    if KEEP
                        && self.lexer.tolerant
                        && (is_parenthesized || !self.last_type_takes_qualifier())
                    {
                        finish!();
                    }
                    self.lexer.next()?;
                    if self.lexer.has_newline_before
                        && self.lexer.tolerant
                        && self.is_name_after_dot_missing()
                    {
                        if KEEP {
                            self.append_missing_qualified_name();
                        }
                        continue;
                    }
                    if !self.lexer.is_identifier_or_keyword() {
                        if self.lexer.tolerant {
                            self.skip_missing_name_after_dot::<KEEP>()?;
                            continue;
                        }
                        self.lexer.expect(T::TIdentifier)?;
                    }

                    if GET_METADATA {
                        // `find_symbol` borrows `&mut self`; `result` is a disjoint fn
                        // parameter so the borrows do not conflict.
                        let ident = self.lexer.identifier;
                        let r = result
                            .as_deref_mut()
                            .expect("infallible: GET_METADATA implies Some");
                        match r {
                            Metadata::MIdentifier(id_ref) => {
                                let id_ref = *id_ref;
                                let mut dot: Vec<Ref> = Vec::with_capacity(2);
                                dot.push(id_ref);
                                let find_result = self.find_symbol(bun_ast::Loc::EMPTY, ident)?;
                                dot.push(find_result.r#ref);
                                *r = Metadata::MDot(dot);
                            }
                            Metadata::MDot(dot) => {
                                if self.lexer.is_identifier_or_keyword() {
                                    let find_result =
                                        self.find_symbol(bun_ast::Loc::EMPTY, ident)?;
                                    dot.push(find_result.r#ref);
                                }
                            }
                            _ => {}
                        }
                    }

                    if KEEP {
                        self.append_qualified_name();
                    }
                    self.lexer.next()?;

                    // "{ <A extends B>(): c.d \n <E extends F>(): g.h }" must not become a single type
                    if !self.lexer.has_newline_before {
                        if KEEP {
                            let reference = self.last_type();
                            let has_arguments =
                                self.skip_type_script_type_arguments::<false, false>()?;
                            self.attach_type_args(reference, has_arguments);
                        } else {
                            let _ = self.skip_type_script_type_arguments::<false, false>()?;
                        }
                    }
                }
                T::TOpenBracket => {
                    // "{ ['x']: string \n ['y']: string }" must not become a single type
                    if self.lexer.has_newline_before {
                        finish!();
                    }
                    let object = if KEEP { self.last_type() } else { TypeId::NONE };
                    self.lexer.next()?;
                    let mut skipped = false;
                    // `parsePostfixTypeOrHigher`: before what starts no type it is an array type whose "]" is missing.
                    if self.lexer.token != T::TCloseBracket
                        && !(self.lexer.tolerant && !self.is_start_of_type(false))
                    {
                        skipped = true;
                        if KEEP {
                            self.skip_nested_type::<true>(
                                Level::Lowest,
                                SkipTypeOptionsBitset::empty(),
                            )?;
                        } else {
                            self.skip_type_script_type(Level::Lowest)?;
                        }
                    }
                    self.lexer.expect(T::TCloseBracket)?;
                    if KEEP {
                        if skipped {
                            let index = self.last_type();
                            let access = TypeData::IndexedAccess { object, index };
                            self.emit_type_if_complete(&[object, index], access, pos);
                        } else {
                            self.emit_type_if_complete(&[object], TypeData::Array(object), pos);
                        }
                    }

                    if GET_METADATA {
                        let r = result
                            .as_deref_mut()
                            .expect("infallible: GET_METADATA implies Some");
                        if matches!(*r, Metadata::MNone) {
                            *r = Metadata::MArray;
                        } else {
                            // if something was skipped, it is object type
                            if skipped {
                                *r = Metadata::MObject;
                            } else {
                                *r = Metadata::MArray;
                            }
                        }
                    }
                }
                T::TExtends => {
                    // "{ x: number \n extends: boolean }" must not become a single type
                    if self.lexer.has_newline_before
                        || opts.contains(SkipTypeOptions::DisallowConditionalTypes)
                    {
                        finish!();
                    }
                    // In "A | B extends C ? D : E" the check type is all of "A | B", so a nested operand returns here and lets the
                    // outermost call build the conditional type. The same tokens are consumed either way.
                    if KEEP && level != Level::Lowest {
                        finish!();
                    }

                    self.lexer.next()?;

                    if KEEP {
                        self.finish_union_and_intersection(
                            &mut intersection_base,
                            intersection_start,
                            &mut union_base,
                            start,
                        );
                        let check = self.last_type();
                        self.skip_nested_type::<true>(
                            Level::Lowest,
                            SkipTypeOptionsBitset::only(SkipTypeOptions::DisallowConditionalTypes),
                        )?;
                        let extends = self.last_type();
                        self.lexer.expect(T::TQuestion)?;
                        self.skip_nested_type::<true>(
                            Level::Lowest,
                            SkipTypeOptionsBitset::empty(),
                        )?;
                        let yes = self.last_type();
                        self.lexer.expect(T::TColon)?;
                        self.skip_nested_type::<true>(
                            Level::Lowest,
                            SkipTypeOptionsBitset::empty(),
                        )?;
                        let no = self.last_type();
                        let conditional = TypeData::Conditional {
                            check,
                            extends,
                            when_true: yes,
                            when_false: no,
                        };
                        self.emit_type_if_complete(&[check, extends, yes, no], conditional, start);
                        continue;
                    }

                    // The type following "extends" is not permitted to be another conditional type
                    let mut extends_type = if GET_METADATA {
                        Some(Metadata::DEFAULT)
                    } else {
                        None
                    };
                    self.skip_type_script_type_with_opts::<GET_METADATA>(
                        Level::Lowest,
                        SkipTypeOptionsBitset::only(SkipTypeOptions::DisallowConditionalTypes),
                        extends_type.as_mut(),
                    )?;

                    if GET_METADATA {
                        // intersection
                        self.lexer.expect(T::TQuestion)?;
                        let mut left = self.skip_type_script_type_with_metadata(Level::Lowest)?;
                        self.lexer.expect(T::TColon)?;
                        if let Some(final_) =
                            Metadata::finish_intersection(&mut left, |r| self.load_name_from_ref(r))
                        {
                            **result
                                .as_mut()
                                .expect("infallible: GET_METADATA implies Some") = final_;
                            self.skip_type_script_type(Level::Lowest)?;
                        } else {
                            self.skip_type_script_type_with_opts::<GET_METADATA>(
                                Level::BitwiseAnd,
                                SkipTypeOptionsBitset::empty(),
                                result.as_deref_mut(),
                            )?;
                            Metadata::merge_intersection(
                                result
                                    .as_deref_mut()
                                    .expect("infallible: GET_METADATA implies Some"),
                                left,
                            );
                        }
                    } else {
                        self.lexer.expect(T::TQuestion)?;
                        self.skip_type_script_type(Level::Lowest)?;
                        self.lexer.expect(T::TColon)?;
                        self.skip_type_script_type(Level::Lowest)?;
                    }
                }
                _ => {
                    finish!();
                }
            }
        }
    }

    pub(crate) fn skip_type_script_object_type(&mut self) -> Result<(), Error> {
        self.mark_type_script_only();

        let open_brace = self.lexer.loc().start;
        if self.lexer.token != T::TOpenBrace && self.lexer.tolerant {
            return self.skip_missing_object_type();
        }
        self.lexer.expect(T::TOpenBrace)?;
        // Keep mode stores the result in `TypeSyntax::last_object_type`.
        let keeps = self.should_keep_types();
        let mut kept = ObjectTypeBuilder::default();
        // Applies to these braces only, not to object types nested in them.
        let is_interface_body =
            keeps && core::mem::take(&mut self.type_syntax_mut().next_braces_are_interface_body);

        let tolerant = self.lexer.tolerant;
        let mut starts_mapped_type =
            tolerant && !is_interface_body && self.is_start_of_mapped_type();
        let saved_contexts = self.enter_list(ListKind::TypeMembers);
        while self.lexer.token != T::TCloseBrace {
            // `parseMappedType` reads "[K in T]: X" itself, before the list of members.
            let is_mapped_type = core::mem::take(&mut starts_mapped_type);
            if !is_mapped_type {
                match self.classify_list_token(ListKind::TypeMembers)? {
                    ListStep::Element => {}
                    ListStep::Skipped => continue,
                    ListStep::Over => break,
                }
            }
            // `parseTypeMember`: the one member that may have a body.
            let is_accessor = tolerant && self.is_at_accessor_in_type();
            // Filled in as the member is parsed. Only used in keep mode.
            let mut member = TypeMemberParts {
                is_accessor,
                ..Default::default()
            };
            if keeps {
                member.start = self.token_start();
            }

            // "{ -readonly [K in keyof T]: T[K] }"
            // "{ +readonly [K in keyof T]: T[K] }"
            if self.lexer.token == T::TPlus || self.lexer.token == T::TMinus {
                member.leading_sign = Some(self.lexer.token == T::TPlus);
                self.lexer.next()?;
            }

            // Skip over modifiers and the property identifier
            let mut found_key = false;
            // `parsePropertyOrMethodSignature`: "= value" may come after "name: T", "name?" and "[computed]", not after a bare
            // name or a method.
            let mut takes_initializer = false;
            // "[key: T]", "[K in T]": `parseIndexSignatureDeclaration` and `parseMappedType` take no initializer.
            let mut is_indexer = false;
            let mut is_optional = false;
            while self.lexer.is_identifier_or_keyword()
                || self.lexer.token == T::TStringLiteral
                || self.lexer.token == T::TNumericLiteral
                // `isLiteralPropertyName`. The checker objects (1539).
                || (self.lexer.token == T::TBigIntegerLiteral && tolerant)
            {
                if keeps {
                    let word = self.read_member_word();
                    member.add_word(word);
                }
                self.lexer.next()?;
                found_key = true;
            }

            if self.lexer.token == T::TOpenBracket
                && tolerant
                && !is_mapped_type
                && !is_accessor
                && self.is_unambiguously_index_signature()
            {
                self.skip_index_signature(&mut member)?;
                if keeps {
                    self.finish_type_member(&member, &mut kept);
                }
                self.skip_type_member_separator()?;
                continue;
            }

            if self.lexer.token == T::TOpenBracket {
                // Index signature or computed property
                if keeps {
                    member.bracket_pos = self.token_start();
                    member.newline_before_bracket = self.lexer.has_newline_before;
                }
                self.lexer.next()?;
                if keeps {
                    member.bracket_kind = BracketKind::Computed;
                    member.bracket_name = self.read_member_word();
                }
                let can_be_mapped_type =
                    !is_interface_body && kept.is_empty() && member.has_only_readonly();
                // `parseTypeMember`: what is no index signature has a computed name.
                if keeps
                    && (if tolerant {
                        !is_mapped_type
                    } else {
                        self.is_start_of_computed_member_name(can_be_mapped_type)
                    })
                {
                    // `parseComputedPropertyName`
                    member.computed_name = Some(self.parse_detached(|p| {
                        let old_allow_in = core::mem::replace(&mut p.allow_in, true);
                        let name = p.parse_expr(Level::Lowest);
                        p.allow_in = old_allow_in;
                        name
                    })?);
                } else {
                    self.skip_type_script_type_with_opts::<false>(
                        Level::Lowest,
                        SkipTypeOptionsBitset::only(SkipTypeOptions::IsIndexSignature),
                        None,
                    )?;
                }

                // "{ [key: string]: number }"
                // "{ readonly [K in keyof T]: T[K] }"
                // `parseComputedPropertyName`: only "]" can follow the expression.
                let is_computed_name = tolerant && member.computed_name.is_some();
                match self.lexer.token {
                    T::TColon if !is_computed_name => {
                        is_indexer = true;
                        self.lexer.next()?;
                        self.skip_type_script_type(Level::Lowest)?;
                        if keeps {
                            member.bracket_kind = BracketKind::Index(self.last_type());
                        }
                    }
                    T::TIn if !is_computed_name => {
                        is_indexer = true;
                        self.lexer.next()?;
                        self.skip_type_script_type(Level::Lowest)?;
                        let constraint = if keeps {
                            self.last_type()
                        } else {
                            TypeId::NONE
                        };
                        let mut name_type = Some(TypeId::NONE);
                        if self.lexer.is_contextual_keyword(b"as") {
                            // "{ [K in keyof T as `get-${K}`]: T[K] }"
                            self.lexer.next()?;
                            self.skip_type_script_type(Level::Lowest)?;
                            if keeps {
                                name_type = Some(self.last_type()).filter(|ty| ty.is_some());
                            }
                        }
                        member.bracket_kind = BracketKind::Mapped(constraint, name_type);
                    }
                    _ => {
                        takes_initializer = true;
                    }
                }

                self.lexer.expect(T::TCloseBracket)?;

                // "{ [K in keyof T]+?: T[K] }"
                // "{ [K in keyof T]-?: T[K] }"
                match self.lexer.token {
                    T::TPlus | T::TMinus => {
                        member.trailing_sign = Some(self.lexer.token == T::TPlus);
                        self.lexer.next()?;
                    }
                    _ => {}
                }

                found_key = true;
            }

            // "?" indicates an optional property
            // "!" indicates an initialization assertion
            if found_key
                && (self.lexer.token == T::TQuestion || self.lexer.token == T::TExclamation)
            {
                is_optional = true;
                takes_initializer = !is_indexer && self.lexer.token == T::TQuestion;
                member.is_optional = self.lexer.token == T::TQuestion;
                member.is_complete &= member.is_optional;
                self.lexer.next()?;
            }

            // Type parameters come right after the optional mark
            let type_parameters =
                self.skip_type_script_type_parameters(TypeParameterFlag::ALLOW_CONST_MODIFIER)?;
            if keeps && type_parameters != SkipTypeParameterResult::DidNotSkipAnything {
                member.type_parameters = Some(self.type_syntax_mut().last_type_params.take());
            }
            if type_parameters != SkipTypeParameterResult::DidNotSkipAnything
                && self.lexer.token != T::TOpenParen
                && tolerant
            {
                self.skip_signature_without_parameters(&mut member)?;
                if keeps {
                    self.finish_type_member(&member, &mut kept);
                }
                self.skip_type_member_separator()?;
                continue;
            }

            match self.lexer.token {
                T::TColon => {
                    // Regular property
                    if !found_key {
                        self.lexer.expect(T::TIdentifier)?;
                    }

                    self.lexer.next()?;
                    self.skip_type_script_type(Level::Lowest)?;
                    if keeps {
                        member.ty = Some(self.last_type());
                    }
                    takes_initializer = !is_indexer;
                }
                T::TOpenParen => {
                    // Method signature
                    takes_initializer = false;
                    if keeps {
                        member.open_paren = self.token_start();
                    }
                    self.skip_typescript_fn_args()?;
                    if keeps {
                        member.parameters = Some(self.type_syntax_mut().last_params.take());
                    }

                    if self.lexer.token == T::TColon {
                        self.lexer.next()?;
                        self.skip_typescript_return_type()?;
                        if keeps {
                            member.ty = Some(self.last_type());
                        }
                    } else if self.lexer.token == T::TEqualsGreaterThan && tolerant && !is_accessor
                    {
                        self.skip_return_type_after_arrow(&mut member)?;
                    }
                }
                _ => {
                    if self.lexer.token == T::TPrivateIdentifier
                        && tolerant
                        && !(is_optional || takes_initializer || is_indexer)
                    {
                        // Nothing but words came before it, which were modifiers.
                        takes_initializer = self.skip_private_type_member(&mut member)?;
                    } else if !found_key {
                        self.lexer.unexpected()?;
                        return Err(crate::Error::SyntaxError);
                    }
                }
            }
            if self.lexer.token == T::TEquals && takes_initializer && tolerant {
                // The checker says that it does not belong here (1246, 1247).
                member.initializer = Some(self.skip_initializer_in_signature()?);
            }
            if keeps {
                self.finish_type_member(&member, &mut kept);
            }
            match self.lexer.token {
                T::TCloseBrace => {}
                T::TComma | T::TSemicolon => {
                    self.lexer.next()?;
                }
                _ => {
                    if is_accessor && self.lexer.token == T::TOpenBrace {
                        // `parseFunctionBlockOrSemicolon`: nothing separates a body from the next member.
                        let body = self.skip_accessor_body_in_type()?;
                        if keeps {
                            self.add_accessor_body(&kept, &body);
                        }
                        continue;
                    }
                    if !self.lexer.has_newline_before {
                        if tolerant {
                            self.skip_type_member_separator()?;
                            continue;
                        }
                        self.lexer.unexpected()?;
                        return Err(crate::Error::SyntaxError);
                    }
                }
            }
        }
        self.lexer.list_contexts = saved_contexts;
        self.lexer.expect(T::TCloseBrace)?;
        if keeps {
            self.finish_object_type(kept, open_brace);
        }
        Ok(())
    }

    /// `parseObjectTypeMembers` without the "{": it is reported, there are no members, and no "}" is looked for.
    #[cold]
    #[inline(never)]
    fn skip_missing_object_type(&mut self) -> Result<(), Error> {
        let at = self.lexer.loc().start;
        self.lexer.expect(T::TOpenBrace)?;
        if self.should_keep_types() {
            self.type_syntax_mut().next_braces_are_interface_body = false;
            self.finish_object_type(ObjectTypeBuilder::default(), at);
        }
        Ok(())
    }

    /// `nextIsStartOfMappedType`, at the token after the "{". Only looks.
    #[cold]
    #[inline(never)]
    fn is_start_of_mapped_type(&mut self) -> bool {
        if !matches!(self.lexer.token, T::TPlus | T::TMinus | T::TOpenBracket)
            && !self.lexer.is_contextual_keyword(b"readonly")
        {
            return false;
        }
        let (here, swallowed) = (self.lexer.snapshot(), self.lexer.swallowed);
        self.lexer.is_log_disabled = true;
        let found = self.scan_start_of_mapped_type().unwrap_or(false);
        self.lexer.restore(&here);
        self.lexer.swallowed = swallowed;
        found
    }

    fn scan_start_of_mapped_type(&mut self) -> Result<bool, Error> {
        if matches!(self.lexer.token, T::TPlus | T::TMinus) {
            self.lexer.next()?;
            return Ok(self.lexer.is_contextual_keyword(b"readonly"));
        }
        if self.lexer.is_contextual_keyword(b"readonly") {
            self.lexer.next()?;
        }
        if self.lexer.token != T::TOpenBracket {
            return Ok(false);
        }
        self.lexer.next()?;
        if !self.is_identifier_in_context() {
            return Ok(false);
        }
        self.lexer.next()?;
        Ok(self.lexer.token == T::TIn)
    }

    /// `parseTypeMemberSemicolon`. A missing separator is reported, and the token stays.
    #[cold]
    #[inline(never)]
    fn skip_type_member_separator(&mut self) -> Result<(), Error> {
        if matches!(self.lexer.token, T::TComma | T::TSemicolon) {
            self.lexer.next()?;
        } else if !self.can_parse_semicolon() {
            self.lexer.expect(T::TSemicolon)?;
        }
        Ok(())
    }

    /// `parseIndexSignatureDeclaration`, at the "[", up to the separator.
    #[cold]
    #[inline(never)]
    fn skip_index_signature(&mut self, member: &mut TypeMemberParts) -> Result<(), Error> {
        let keeps = self.should_keep_types();
        if keeps {
            member.bracket_pos = self.token_start();
            member.newline_before_bracket = self.lexer.has_newline_before;
        }
        member.trailing_comma = self.skip_index_signature_parameter_list()?;
        if keeps {
            member.bracket_kind = BracketKind::IndexParameters;
            member.parameters = Some(self.type_syntax_mut().last_params.take());
        }
        if self.lexer.token == T::TColon {
            self.lexer.next()?;
            self.skip_type_script_type(Level::Lowest)?;
            if keeps {
                member.ty = Some(self.last_type());
            }
        }
        Ok(())
    }

    /// `parseParameters` after type parameters that no "(" follows: it is reported, there are no parameters, and no ")" is looked for.
    /// Then the return type.
    #[cold]
    #[inline(never)]
    fn skip_signature_without_parameters(
        &mut self,
        member: &mut TypeMemberParts,
    ) -> Result<(), Error> {
        let keeps = self.should_keep_types();
        if keeps {
            member.open_paren = self.token_start();
            member.parameters = Some(Some((Default::default(), ThisParam::NONE)));
        }
        self.lexer.expect(T::TOpenParen)?;
        if self.lexer.token == T::TColon {
            self.lexer.next()?;
            self.skip_typescript_return_type()?;
            if keeps {
                member.ty = Some(self.last_type());
            }
        } else if self.lexer.token == T::TEqualsGreaterThan && !member.is_accessor {
            self.skip_return_type_after_arrow(member)?;
        }
        Ok(())
    }

    /// `shouldParseReturnType(":", isType)`: "=>" after the parameters of a signature in a type is reported and taken for the ":".
    #[cold]
    #[inline(never)]
    fn skip_return_type_after_arrow(&mut self, member: &mut TypeMemberParts) -> Result<(), Error> {
        self.lexer.expect(T::TColon)?;
        self.lexer.next()?;
        self.skip_typescript_return_type()?;
        if self.should_keep_types() {
            member.ty = Some(self.last_type());
        }
        Ok(())
    }

    /// `parseContextualModifier(get | set)`, at the first token of a type member: the word makes an accessor when the name of a
    /// property follows, on whichever line. After modifiers it makes none: `scanTypeMemberStart` lets no such member start.
    #[cold]
    #[inline(never)]
    fn is_at_accessor_in_type(&mut self) -> bool {
        (self.lexer.is_contextual_keyword(b"get") || self.lexer.is_contextual_keyword(b"set"))
            && self.next_token_matches(|p| {
                p.lexer.is_identifier_or_keyword()
                    || matches!(
                        p.lexer.token,
                        T::TStringLiteral
                            | T::TNumericLiteral
                            | T::TBigIntegerLiteral
                            | T::TPrivateIdentifier
                            | T::TOpenBracket
                    )
            })
    }

    /// `parseFunctionBlock`: the body of an accessor in a type is read like any other, and the checker objects to it (1183).
    #[cold]
    #[inline(never)]
    fn skip_accessor_body_in_type(&mut self) -> Result<bun_ast::G::FnBody, Error> {
        self.parse_detached(|p| {
            // `parse_fn_body` wants the scope of the parameters around that of the body, and from before it.
            let before_body = bun_ast::Loc {
                start: p.lexer.loc().start - 1,
            };
            let scope_index =
                p.push_scope_for_parse_pass(bun_ast::scope::Kind::FunctionArgs, before_body)?;
            let body = p.parse_fn_body(&mut FnOrArrowDataParse::default())?;
            p.pop_and_discard_scope(scope_index);
            Ok(body)
        })
    }

    /// `parsePropertyOrMethodSignature` from a private name on, which `parsePropertyName` takes for the name and the checker objects
    /// to (18016), up to where an initializer would be. Whether there may be one: as after any other name.
    #[cold]
    #[inline(never)]
    fn skip_private_type_member(&mut self, member: &mut TypeMemberParts) -> Result<bool, Error> {
        let keeps = self.should_keep_types();
        if keeps && self.lexer.token == T::TPrivateIdentifier {
            let word = self.read_member_word();
            member.add_word(word);
        }
        self.lexer.expect(T::TPrivateIdentifier)?;
        let mut takes_initializer = false;
        if self.lexer.token == T::TQuestion {
            self.lexer.next()?;
            member.is_optional = true;
            takes_initializer = true;
        }
        if matches!(self.lexer.token, T::TOpenParen | T::TLessThan) {
            let type_parameters =
                self.skip_type_script_type_parameters(TypeParameterFlag::ALLOW_CONST_MODIFIER)?;
            if keeps && type_parameters != SkipTypeParameterResult::DidNotSkipAnything {
                member.type_parameters = Some(self.type_syntax_mut().last_type_params.take());
            }
            if keeps {
                member.open_paren = self.token_start();
            }
            self.skip_typescript_fn_args()?;
            if keeps {
                member.parameters = Some(self.type_syntax_mut().last_params.take());
            }
            if self.lexer.token == T::TColon {
                self.lexer.next()?;
                self.skip_typescript_return_type()?;
                if keeps {
                    member.ty = Some(self.last_type());
                }
            }
            return Ok(false);
        }
        if self.lexer.token == T::TColon {
            self.lexer.next()?;
            self.skip_type_script_type(Level::Lowest)?;
            if keeps {
                member.ty = Some(self.last_type());
            }
            takes_initializer = true;
        }
        Ok(takes_initializer)
    }

    // This is the type parameter declarations that go with other symbol
    // declarations (class, function, type, etc.)
    pub(crate) fn skip_type_script_type_parameters(
        &mut self,
        flags: TypeParameterFlag,
    ) -> Result<SkipTypeParameterResult, Error> {
        self.mark_type_script_only();

        if self.lexer.token != T::TLessThan {
            return Ok(SkipTypeParameterResult::DidNotSkipAnything);
        }

        let mut result = SkipTypeParameterResult::CouldBeTypeCast;
        let less_than = self.lexer.loc();
        self.lexer.next()?;
        if self.lexer.tolerant {
            return self.skip_type_parameters_tolerant(flags, less_than);
        }
        // Keep mode stores the result in `TypeSyntax::last_type_params`.
        let keeps = self.should_keep_types();
        let mut kept: Vec<TypeParam> = Vec::new();
        let mut is_complete = true;

        if self.lexer.token == T::TGreaterThan
            && flags.contains(TypeParameterFlag::ALLOW_EMPTY_TYPE_PARAMETERS)
        {
            self.lexer.next()?;
            if keeps {
                self.finish_type_params(Some(&kept), less_than.start);
            }
            return Ok(SkipTypeParameterResult::DefinitelyTypeParameters);
        }

        loop {
            let mut has_in = false;
            let mut has_out = false;
            let mut expect_identifier = true;
            let mut parameter = TypeParam {
                name: StoreStr::EMPTY,
                loc: bun_ast::Loc::EMPTY,
                start: self.lexer.loc(),
                constraint: TypeId::NONE,
                default: TypeId::NONE,
                flags: Flags::empty(),
            };
            // Offset of the last "out". It is the parameter's name if no identifier follows.
            let mut out_pos = 0;

            let mut invalid_modifier_range = bun_ast::Range::NONE;

            // Scan over a sequence of "in" and "out" modifiers (a.k.a. optional
            // variance annotations) as well as "const" modifiers
            loop {
                if self.lexer.token == T::TConst {
                    if invalid_modifier_range.len == 0
                        && !flags.contains(TypeParameterFlag::ALLOW_CONST_MODIFIER)
                    {
                        // Valid:
                        //   "class Foo<const T> {}"
                        // Invalid:
                        //   "interface Foo<const T> {}"
                        invalid_modifier_range = self.lexer.range();
                    }

                    result = SkipTypeParameterResult::DefinitelyTypeParameters;
                    self.lexer.next()?;
                    expect_identifier = true;
                    parameter.flags |= Flags::CONST;
                    continue;
                }

                if self.lexer.token == T::TIn {
                    if invalid_modifier_range.len == 0
                        && (!flags.contains(TypeParameterFlag::ALLOW_IN_OUT_VARIANCE_ANNOTATIONS)
                            || has_in
                            || has_out)
                    {
                        // Valid:
                        //   "type Foo<in T> = T"
                        // Invalid:
                        //   "type Foo<in in T> = T"
                        //   "type Foo<out in T> = T"
                        invalid_modifier_range = self.lexer.range();
                    }

                    self.lexer.next()?;
                    has_in = true;
                    expect_identifier = true;
                    parameter.flags |= Flags::IN;
                    continue;
                }

                if self.lexer.is_contextual_keyword(b"out") {
                    let r = self.lexer.range();
                    // A second "out" means the previous one was a modifier.
                    if has_out {
                        parameter.flags |= Flags::OUT;
                    }
                    out_pos = r.loc.start.max(0) as u32;
                    if invalid_modifier_range.len == 0
                        && !flags.contains(TypeParameterFlag::ALLOW_IN_OUT_VARIANCE_ANNOTATIONS)
                    {
                        // Valid:
                        //   "type Foo<out T> = T"
                        // Invalid:
                        //   "type Foo<out out T> = T"
                        //   "type Foo<in out T> = T"
                        invalid_modifier_range = r;
                    }

                    self.lexer.next()?;
                    if invalid_modifier_range.len == 0
                        && has_out
                        && (self.lexer.token == T::TIn || self.lexer.token == T::TIdentifier)
                    {
                        // Valid:
                        //   "type Foo<out T> = T"
                        //   "type Foo<out out> = T"
                        //   "type Foo<out out, T> = T"
                        //   "type Foo<out out = T> = T"
                        //   "type Foo<out out extends T> = T"
                        // Invalid:
                        //   "type Foo<out out in T> = T"
                        //   "type Foo<out out T> = T"
                        invalid_modifier_range = r;
                    }
                    has_out = true;
                    expect_identifier = false;
                    continue;
                }

                break;
            }

            // Only report an error for the first invalid modifier
            if invalid_modifier_range.len > 0 {
                self.log().add_range_error_fmt(
                    Some(self.source),
                    invalid_modifier_range,
                    format_args!(
                        "The modifier \"{}\" is not valid here",
                        bstr::BStr::new(self.source.text_for_range(invalid_modifier_range)),
                    ),
                );
            }

            // expectIdentifier => Mandatory identifier (e.g. after "type Foo <in ___")
            // !expectIdentifier => Optional identifier (e.g. after "type Foo <out ___" since "out" may be the identifier)
            if expect_identifier || self.lexer.token == T::TIdentifier {
                if keeps {
                    if has_out {
                        parameter.flags |= Flags::OUT;
                    }
                    parameter.name = StoreStr::new(self.lexer.identifier);
                    parameter.loc = self.lexer.loc();
                    is_complete &= self.lexer.token == T::TIdentifier;
                }
                self.lexer.expect(T::TIdentifier)?;
            } else {
                if keeps {
                    parameter.name = StoreStr::new(b"out");
                    parameter.loc = bun_ast::Loc {
                        start: out_pos as i32,
                    };
                }
            }

            // "class Foo<T extends number> {}"
            if self.lexer.token == T::TExtends {
                result = SkipTypeParameterResult::DefinitelyTypeParameters;
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
                if keeps {
                    parameter.constraint = self.last_type();
                    is_complete &= parameter.constraint.is_some();
                }
            }

            // "class Foo<T = void> {}"
            if self.lexer.token == T::TEquals {
                result = SkipTypeParameterResult::DefinitelyTypeParameters;
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
                if keeps {
                    parameter.default = self.last_type();
                    is_complete &= parameter.default.is_some();
                }
            }
            if keeps {
                kept.push(parameter);
            }

            if self.lexer.token != T::TComma {
                break;
            }

            self.lexer.next()?;

            if self.lexer.token == T::TGreaterThan {
                result = SkipTypeParameterResult::DefinitelyTypeParameters;
                break;
            }
        }

        self.lexer.expect_greater_than::<false>()?;
        self.mark_type_syntax(
            self.lexer.loc(),
            crate::sema::Mark::TypeParameters,
            less_than,
        );
        if keeps {
            self.finish_type_params(is_complete.then_some(&kept[..]), less_than.start);
        }
        Ok(result)
    }

    /// `parseBracketedList(PCTypeParameters, parseTypeParameter, "<", ">")`, after the "<" at `less_than`. Tolerant mode only.
    #[cold]
    #[inline(never)]
    fn skip_type_parameters_tolerant(
        &mut self,
        flags: TypeParameterFlag,
        less_than: bun_ast::Loc,
    ) -> Result<SkipTypeParameterResult, Error> {
        // TypeScript's scanner makes a token of its own of every ">".
        let is_at_greater_than = |p: &Self| {
            matches!(
                p.lexer.token,
                T::TGreaterThan
                    | T::TGreaterThanEquals
                    | T::TGreaterThanGreaterThan
                    | T::TGreaterThanGreaterThanEquals
                    | T::TGreaterThanGreaterThanGreaterThan
                    | T::TGreaterThanGreaterThanGreaterThanEquals
            )
        };
        let keeps = self.should_keep_types();
        let mut kept: Vec<TypeParam> = Vec::new();
        let mut is_complete = true;
        let mut result = SkipTypeParameterResult::CouldBeTypeCast;

        if is_at_greater_than(self) {
            // "<>" is no error to the parser. It never starts an arrow function (`isParenthesizedArrowFunctionExpression`).
            if self.lexer.is_log_disabled
                && !flags.contains(TypeParameterFlag::ALLOW_EMPTY_TYPE_PARAMETERS)
            {
                self.lexer.expected(T::TIdentifier)?;
            }
            // `checkGrammarClassLikeDeclaration`. The checker finds the empty list of a function in the text.
            if flags.contains(
                TypeParameterFlag::ALLOW_IN_OUT_VARIANCE_ANNOTATIONS
                    | TypeParameterFlag::ALLOW_CONST_MODIFIER,
            ) {
                self.lexer.ts_grammar_error(
                    bun_ast::Range {
                        loc: less_than,
                        len: 1,
                    },
                    1098,
                );
            }
            self.lexer.expect_greater_than::<false>()?;
            if keeps {
                self.finish_type_params(Some(&kept), less_than.start);
            }
            return Ok(SkipTypeParameterResult::DefinitelyTypeParameters);
        }

        let saved_contexts = self.enter_list(ListKind::TypeParameters);
        let mut is_empty = true;
        while !is_at_greater_than(self) {
            match self.classify_list_token(ListKind::TypeParameters)? {
                ListStep::Element => {}
                ListStep::Skipped => continue,
                ListStep::Over => break,
            }
            let element_start = self.lexer.loc();
            is_empty = false;
            let parameter = self.skip_type_parameter_tolerant(flags, &mut result)?;
            if keeps {
                is_complete &= parameter.is_some();
                kept.extend(parameter);
            }

            if self.lexer.token != T::TComma {
                if !is_at_greater_than(self)
                    && self.recover_missing_comma(ListKind::TypeParameters, element_start)?
                {
                    continue;
                }
                break;
            }
            self.lexer.next()?;
            // "<T,>"
            if is_at_greater_than(self) {
                result = SkipTypeParameterResult::DefinitelyTypeParameters;
            }
        }
        self.lexer.list_contexts = saved_contexts;
        // `checkGrammarTypeParameterList`
        if is_empty {
            self.lexer.ts_grammar_error(
                bun_ast::Range {
                    loc: less_than,
                    len: 1,
                },
                1098,
            );
        }

        self.lexer.expect_greater_than::<false>()?;
        self.mark_type_syntax(
            self.lexer.loc(),
            crate::sema::Mark::TypeParameters,
            less_than,
        );
        if keeps {
            self.finish_type_params(is_complete.then_some(&kept[..]), less_than.start);
        }
        Ok(result)
    }

    /// `parseTypeParameter`. `None` if its constraint or default is unusable.
    #[cold]
    #[inline(never)]
    fn skip_type_parameter_tolerant(
        &mut self,
        flags: TypeParameterFlag,
        result: &mut SkipTypeParameterResult,
    ) -> Result<Option<TypeParam>, Error> {
        let keeps = self.should_keep_types();
        let mut is_complete = true;
        let mut parameter = TypeParam {
            name: StoreStr::EMPTY,
            loc: bun_ast::Loc::EMPTY,
            start: self.lexer.loc(),
            constraint: TypeId::NONE,
            default: TypeId::NONE,
            flags: Flags::empty(),
        };

        // `parseModifiersEx`: any modifier keyword that the rest of a declaration can follow (`nextTokenCanFollowModifier`).
        // `checkGrammarModifiers` reports the first that is wrong.
        let mut has_error = false;
        let mut has_static = false;
        while self.is_modifier_kind() && !matches!(self.lexer.token, T::TExport | T::TDefault) {
            let is_static = self.lexer.is_contextual_keyword(b"static");
            if is_static && has_static {
                break;
            }
            let is_modifier = self.next_token_matches(|p| {
                (is_static || !p.lexer.has_newline_before)
                    && (p.lexer.is_identifier_or_keyword()
                        || matches!(
                            p.lexer.token,
                            T::TPrivateIdentifier
                                | T::TOpenBracket
                                | T::TOpenBrace
                                | T::TAsterisk
                                | T::TDotDotDot
                                | T::TStringLiteral
                                | T::TNumericLiteral
                                | T::TBigIntegerLiteral
                        ))
            });
            if !is_modifier {
                break;
            }
            has_static |= is_static;
            let variance = match self.lexer.token {
                T::TIn => Flags::IN,
                T::TIdentifier if self.lexer.raw() == b"out" => Flags::OUT,
                _ => Flags::empty(),
            };
            let code = if self.lexer.token == T::TConst {
                *result = SkipTypeParameterResult::DefinitelyTypeParameters;
                parameter.flags |= Flags::CONST;
                if flags.contains(TypeParameterFlag::ALLOW_CONST_MODIFIER) {
                    0
                } else {
                    1277
                }
            } else if variance.is_empty() {
                1273
            } else if !flags.contains(TypeParameterFlag::ALLOW_IN_OUT_VARIANCE_ANNOTATIONS) {
                1274
            } else if parameter.flags.contains(variance) {
                1030
            } else if variance == Flags::IN && parameter.flags.contains(Flags::OUT) {
                1029
            } else {
                0
            };
            parameter.flags |= variance;
            if code != 0 && !has_error {
                has_error = true;
                let range = self.lexer.range();
                self.lexer.ts_grammar_error(range, code);
            }
            self.lexer.next()?;
        }

        // `parseIdentifier`
        if self.is_identifier_in_context() {
            parameter.name = StoreStr::new(self.lexer.identifier);
            parameter.loc = self.lexer.loc();
            self.lexer.next()?;
        } else {
            // The name is missing where the token before ends, and the token stays.
            parameter.loc = self.lexer.full_start();
            self.lexer.expect(T::TIdentifier)?;
        }

        if self.lexer.token == T::TExtends {
            *result = SkipTypeParameterResult::DefinitelyTypeParameters;
            self.lexer.next()?;
            if self.is_start_of_type(false) || !self.is_start_of_expression() {
                self.skip_type_script_type(Level::Lowest)?;
                if keeps {
                    parameter.constraint = self.last_type();
                    is_complete &= parameter.constraint.is_some();
                }
            } else {
                // An expression is read as one, and `checkTypeParameter` wants a type.
                let expression = self.lexer.range();
                self.parse_detached(|p| p.parse_expr(Level::Prefix))?;
                self.lexer.ts_grammar_error(expression, 1110);
            }
        }

        if self.lexer.token == T::TEquals {
            *result = SkipTypeParameterResult::DefinitelyTypeParameters;
            self.lexer.next()?;
            self.skip_type_script_type(Level::Lowest)?;
            if keeps {
                parameter.default = self.last_type();
                is_complete &= parameter.default.is_some();
            }
        }
        Ok(is_complete.then_some(parameter))
    }

    pub(crate) fn skip_type_script_type_stmt(
        &mut self,
        opts: &mut ParseStatementOptions,
        keyword_loc: bun_ast::Loc,
    ) -> Result<(), Error> {
        if opts.is_export {
            match self.lexer.token {
                T::TOpenBrace => {
                    // "export type {foo}"
                    // "export type {foo} from 'bar'"
                    let _ = self.parse_export_clause()?;
                    if self.lexer.is_contextual_keyword(b"from") {
                        self.lexer.next()?;
                        let _ = self.parse_path()?;
                    } else if self.lexer.token == T::TStringLiteral
                        && self.lexer.tolerant
                        && !self.lexer.has_newline_before
                    {
                        // `parseExportDeclaration`: a string on the same line is the specifier after a forgotten "from" (1005).
                        self.lexer.expect_contextual_keyword(b"from")?;
                        let _ = self.parse_path()?;
                    }
                    self.lexer.expect_or_insert_semicolon()?;
                    return Ok(());
                }
                T::TAsterisk => {
                    // https://github.com/microsoft/TypeScript/pull/52217
                    // - export type * as Foo from 'bar';
                    // - export type Foo from 'bar';
                    self.lexer.next()?;
                    if self.lexer.is_contextual_keyword(b"as") {
                        // "export type * as ns from 'path'"
                        self.lexer.next()?;
                        let _ = self.parse_clause_alias(b"export")?;
                        self.lexer.next()?;
                    }
                    self.lexer.expect_contextual_keyword(b"from")?;
                    let _ = self.parse_path()?;
                    self.lexer.expect_or_insert_semicolon()?;
                    return Ok(());
                }
                _ => {}
            }
        }

        let name = self.lexer.identifier;
        let name_loc = self.lexer.loc();
        self.lexer.expect(T::TIdentifier)?;

        if opts.scope.is_module() {
            self.local_type_names.put(name, true)?;
        }

        let type_parameters = self.skip_type_script_type_parameters(
            TypeParameterFlag::ALLOW_IN_OUT_VARIANCE_ANNOTATIONS
                | TypeParameterFlag::ALLOW_EMPTY_TYPE_PARAMETERS,
        )?;
        let keeps = self.should_keep_types();
        let type_parameters = if keeps {
            self.take_type_params(type_parameters)
        } else {
            None
        };

        self.lexer.expect(T::TEquals)?;
        let type_loc = self.lexer.loc();
        self.skip_type_script_type(Level::Lowest)?;
        if keeps {
            let name = Name {
                text: StoreStr::new(name),
                loc: name_loc,
            };
            self.emit_type_alias(name, type_parameters, type_loc, keyword_loc);
        }
        self.lexer.expect_or_insert_semicolon()?;
        Ok(())
    }

    pub(crate) fn skip_type_script_interface_stmt(
        &mut self,
        opts: &mut ParseStatementOptions,
        keyword_loc: bun_ast::Loc,
    ) -> Result<(), Error> {
        let name = self.lexer.identifier;
        let name_loc = self.lexer.loc();
        self.lexer.expect(T::TIdentifier)?;

        if opts.scope.is_module() {
            self.local_type_names.put(name, true)?;
        }

        let type_parameters = self.skip_type_script_type_parameters(
            TypeParameterFlag::ALLOW_IN_OUT_VARIANCE_ANNOTATIONS
                | TypeParameterFlag::ALLOW_EMPTY_TYPE_PARAMETERS,
        )?;
        let keeps = self.should_keep_types();
        let type_parameters = if keeps {
            self.take_type_params(type_parameters)
        } else {
            None
        };
        let mut extends: Vec<TypeId> = Vec::new();
        let mut heritage_errors = [None; 2];
        // It takes every clause, which leaves nothing for the two blocks below.
        let has_tolerated_implements_clause = self.lexer.tolerant
            && self.skip_interface_heritage_clauses(&mut extends, &mut heritage_errors)?;

        if self.lexer.token == T::TExtends {
            self.lexer.next()?;

            loop {
                self.skip_type_script_type(Level::Lowest)?;
                if keeps {
                    extends.push(self.last_type());
                }
                if self.lexer.token != T::TComma {
                    break;
                }
                self.lexer.next()?;
            }
        }

        let has_implements_clause = self.lexer.is_contextual_keyword(b"implements");
        if has_implements_clause {
            self.lexer.next()?;
            loop {
                self.skip_type_script_type(Level::Lowest)?;
                if self.lexer.token != T::TComma {
                    break;
                }
                self.lexer.next()?;
            }
        }

        if self.should_keep_types() {
            self.type_syntax_mut().next_braces_are_interface_body = true;
        }
        self.skip_type_script_object_type()?;
        if keeps {
            let name = Name {
                text: StoreStr::new(name),
                loc: name_loc,
            };
            let has_implements_clause = has_implements_clause || has_tolerated_implements_clause;
            self.emit_interface(
                name,
                type_parameters,
                &extends,
                has_implements_clause,
                heritage_errors,
                keyword_loc,
            );
        }
        Ok(())
    }

    /// `parseHeritageClauses` of an interface in tolerant mode: any number of clauses, in any order. `extends` gets the types of the
    /// first "extends" clause (`GetHeritageElements`). `errors` gets what `checkGrammarInterfaceDeclaration` reports, except 1176,
    /// which the checker finds in the text. Returns whether there is an "implements" clause.
    #[cold]
    #[inline(never)]
    fn skip_interface_heritage_clauses(
        &mut self,
        extends: &mut Vec<TypeId>,
        errors: &mut [Option<(bun_ast::Loc, u32)>; 2],
    ) -> Result<bool, Error> {
        // `parseHeritageClauses`: no list unless a clause starts here.
        if self.lexer.token != T::TExtends && !self.lexer.is_contextual_keyword(b"implements") {
            return Ok(false);
        }
        let keeps = self.should_keep_types();
        let (mut seen_extends, mut seen_implements) = (false, false);
        // The checker returns after 1172 or 1176.
        let mut stop_checking = false;
        let saved_clauses = self.enter_list(ListKind::HeritageClauses);
        loop {
            if self.lexer.token != T::TExtends && !self.lexer.is_contextual_keyword(b"implements") {
                // A speculative parse fails at the "{" that is not there.
                if self.lexer.is_log_disabled
                    || self.classify_list_token(ListKind::HeritageClauses)? != ListStep::Skipped
                {
                    break;
                }
                continue;
            }
            let keyword = self.lexer.range();
            let is_extends = self.lexer.token == T::TExtends;
            let is_first_extends = is_extends && !seen_extends;
            if !is_first_extends && !stop_checking {
                stop_checking = true;
                if is_extends {
                    errors[1] = Some((keyword.loc, 1172));
                }
            }
            seen_extends |= is_extends;
            seen_implements |= !is_extends;
            self.lexer.next()?;

            // `parseHeritageClause`
            let saved_elements = self.enter_list(ListKind::HeritageClauseElement);
            let (mut is_empty, mut trailing_comma) = (true, None);
            loop {
                if self.lexer.is_log_disabled {
                    if !self.is_list_element(ListKind::HeritageClauseElement, false) {
                        break;
                    }
                } else {
                    match self.classify_list_token(ListKind::HeritageClauseElement)? {
                        ListStep::Element => {}
                        ListStep::Skipped => continue,
                        ListStep::Over => break,
                    }
                }
                let element_start = self.lexer.loc();
                self.skip_interface_heritage_element()?;
                if keeps && is_first_extends {
                    extends.push(self.last_type());
                }
                is_empty = false;
                trailing_comma = None;
                if self.lexer.token == T::TComma {
                    trailing_comma = Some(self.lexer.loc());
                    self.lexer.next()?;
                    continue;
                }
                if !self.recover_missing_comma(ListKind::HeritageClauseElement, element_start)? {
                    break;
                }
            }
            self.lexer.list_contexts = saved_elements;

            // `checkGrammarHeritageClause`
            if !stop_checking {
                if let Some(comma) = trailing_comma {
                    errors[0] = Some((comma, 1009));
                } else if is_empty {
                    errors[0] = Some((keyword.end(), 1097));
                }
            }
        }
        self.lexer.list_contexts = saved_clauses;
        Ok(seen_implements)
    }

    /// `parseExpressionWithTypeArguments` in a heritage clause of an interface. In keep mode the last type is the reference `A.B<C>`,
    /// or `HeritageExpression` for any other expression, which the checker objects to (2499).
    fn skip_interface_heritage_element(&mut self) -> Result<(), Error> {
        let keeps = self.should_keep_types();
        let (start, pos) = (self.lexer.loc().start, self.token_start());
        if !self.is_at_entity_name_expression() {
            // `parseLeftHandSideExpressionOrHigher`
            let scope_index = self.scopes_in_order.len();
            let _ = self.parse_detached(|p| p.parse_expr(Level::New))?;
            self.discard_scopes_up_to(scope_index);
            let _ = self.skip_type_script_type_arguments::<false, false>()?;
            if keeps {
                self.emit_type(TypeData::HeritageExpression, pos);
            }
            return Ok(());
        }
        if keeps {
            let name = self.token_text();
            self.emit_type_ref(name, pos);
        }
        self.lexer.next()?;
        while self.lexer.token == T::TDot {
            self.lexer.next()?;
            if keeps {
                self.append_qualified_name();
            }
            self.lexer.next()?;
        }
        let reference = if keeps {
            self.last_type()
        } else {
            TypeId::NONE
        };
        let has_arguments = self.skip_type_script_type_arguments::<false, false>()?;
        if keeps {
            self.attach_type_args(reference, has_arguments);
            // `type_syntax::Builder` looks it up by offset.
            let ty = self.last_type();
            if ty.is_some() {
                self.record_type(start, ty);
            }
        }
        Ok(())
    }

    /// `IsEntityNameExpression`: whether the expression that starts here is `A.B.C` and nothing more.
    fn is_at_entity_name_expression(&mut self) -> bool {
        if self.lexer.token != T::TIdentifier {
            return false;
        }
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let mut is_name = self.lexer.next().is_ok();
        while is_name && self.lexer.token == T::TDot {
            is_name = self.lexer.next().is_ok()
                && self.lexer.is_identifier_or_keyword()
                && self.lexer.next().is_ok();
        }
        // `parseMemberExpressionRest` and `parseCallExpressionRest` go on with these.
        let goes_on = match self.lexer.token {
            T::TOpenParen
            | T::TOpenBracket
            | T::TQuestionDot
            | T::TNoSubstitutionTemplateLiteral
            | T::TTemplateHead => true,
            T::TExclamation => !self.lexer.has_newline_before,
            _ => false,
        };
        self.lexer.restore(&old_lexer);
        is_name && !goes_on
    }

    #[inline]
    pub(crate) fn skip_type_script_type_arguments<
        const IS_INSIDE_JSX_ELEMENT: bool,
        const IS_PARSE_TYPE_ARGUMENTS_IN_EXPRESSION: bool,
    >(
        &mut self,
    ) -> Result<bool, Error> {
        self.mark_type_script_only();
        match self.lexer.token {
            T::TLessThan
            | T::TLessThanEquals
            | T::TLessThanLessThan
            | T::TLessThanLessThanEquals => {}
            _ => {
                return Ok(false);
            }
        }

        let less_than = self.lexer.loc().start;
        self.lexer.expect_less_than::<false>()?;
        let keeps = self.should_keep_types();
        let args_base = if keeps {
            self.type_syntax_mut().type_stack.len()
        } else {
            0
        };

        let mut is_first = true;
        let saved_contexts = self.enter_list(ListKind::TypeArguments);
        loop {
            // `parseDelimitedList(PCTypeArguments)`: the list ends before whatever is neither a comma nor the start of a type, in
            // TypeScript's own trials too. So it may be empty ("<>") and may end with a comma ("<T,>").
            if self.lexer.tolerant && !self.is_list_element(ListKind::TypeArguments, false) {
                self.check_end_of_type_arguments(is_first, less_than);
                break;
            }
            if keeps {
                self.skip_nested_type::<true>(Level::Lowest, SkipTypeOptionsBitset::empty())?;
                self.push_type_list_item();
            } else {
                self.skip_type_script_type(Level::Lowest)?;
            }
            is_first = false;
            if self.lexer.token != T::TComma {
                break;
            }
            self.lexer.next()?;
        }
        self.lexer.list_contexts = saved_contexts;

        // This type argument list must end with a ">"
        if !IS_PARSE_TYPE_ARGUMENTS_IN_EXPRESSION {
            // Normally TypeScript allows any token starting with ">". For example,
            // "Array<Array<number>>()" is a type argument list even though there's
            // a ">>" token, because ">>" starts with ">".
            self.lexer.expect_greater_than::<IS_INSIDE_JSX_ELEMENT>()?;
        } else {
            // However, when emulating the TypeScript compiler's
            // "parseTypeArgumentsInExpression" function, only the ">" token
            // itself is allowed. For example, "x < y >= z" is not a type argument
            // list. Nested type arguments ("Array<Array<number>>()") still work
            // because the inner list is in a type context and already stripped one
            // ">" from the ">>" before we see the outer closer here.
            if IS_INSIDE_JSX_ELEMENT {
                self.lexer.expect_inside_jsx_element(T::TGreaterThan)?;
            } else {
                self.lexer.expect(T::TGreaterThan)?;
            }
        }
        if keeps {
            self.finish_type_args(args_base, less_than);
        }
        Ok(true)
    }

    /// `checkGrammarTypeArguments`, where a list of type arguments ends and no element starts: "<>" (1099 at the "<", which is at
    /// `less_than`) or "<T,>" (1009 at the comma, which is the previous token).
    #[cold]
    #[inline(never)]
    fn check_end_of_type_arguments(&mut self, is_empty: bool, less_than: i32) {
        let (start, code) = if is_empty {
            (less_than, 1099)
        } else {
            (self.lexer.full_start().start - 1, 1009)
        };
        self.lexer.ts_grammar_error(
            bun_ast::Range {
                loc: bun_ast::Loc { start },
                len: 1,
            },
            code,
        );
    }

    // ───────────────────────── Backtracking ─────────────────────────
    // Two concrete helpers covering the actual call patterns:
    //   - `lexer_backtracker_bool`   — fn returns Result<()>/Result<bool>, helper returns bool
    //   - `lexer_backtracker_result` — fn returns Result<SkipTypeParameterResult>

    #[inline]
    fn lexer_backtracker_bool<F, R>(&mut self, func: F) -> bool
    where
        F: Fn(&mut Self) -> Result<R, Error>,
    {
        self.mark_type_script_only();
        // The Lexer
        // holds `&mut Log`, so backtracking goes through a POD `LexerSnapshot` + `restore()`.
        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        let old_swallowed = self.lexer.swallowed;
        self.lexer.is_log_disabled = true;
        let mut backtrack = false;
        match func(self) {
            Ok(_) => {}
            Err(_) => {
                backtrack = true;
            }
        }

        if backtrack {
            self.lexer.restore(&old_lexer);
            // `rewind` drops the errors.
            self.lexer.swallowed = old_swallowed;
        }
        self.lexer.is_log_disabled = old_log_disabled;

        // Only changes in tolerant mode.
        if self.lexer.swallowed != old_swallowed && !backtrack && !old_log_disabled {
            self.log_errors_of_successful_trial(&old_lexer, &|p: &mut Self| func(p).is_ok());
        }

        !backtrack
    }

    #[inline]
    fn lexer_backtracker_result<F>(&mut self, func: F) -> SkipTypeParameterResult
    where
        F: Fn(&mut Self) -> Result<SkipTypeParameterResult, Error>,
    {
        self.mark_type_script_only();
        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        let old_swallowed = self.lexer.swallowed;
        self.lexer.is_log_disabled = true;
        let mut backtrack = false;
        let result = match func(self) {
            Ok(r) => r,
            Err(_) => {
                backtrack = true;
                SkipTypeParameterResult::DidNotSkipAnything
            }
        };

        if backtrack {
            self.lexer.restore(&old_lexer);
            // `rewind` drops the errors.
            self.lexer.swallowed = old_swallowed;
        }
        self.lexer.is_log_disabled = old_log_disabled;

        // Only changes in tolerant mode.
        if self.lexer.swallowed != old_swallowed && !backtrack && !old_log_disabled {
            self.log_errors_of_successful_trial(&old_lexer, &|p: &mut Self| func(p).is_ok());
        }

        result
    }

    /// `mark`, `rewind`: TypeScript keeps the errors of a speculative parse that succeeds. `trial` succeeded from `start` on with the
    /// log disabled, so it is run again with the log enabled.
    #[cold]
    #[inline(never)]
    fn log_errors_of_successful_trial(
        &mut self,
        start: &crate::lexer::LexerSnapshot<'a>,
        trial: &dyn Fn(&mut Self) -> bool,
    ) {
        let end = self.lexer.start;
        self.lexer.restore(start);
        let snapshot = self.parser_snapshot();
        if trial(self) && self.lexer.start == end {
            return;
        }
        // Error recovery, which is off while the log is disabled, led somewhere else. Keep the outcome of the first run, without errors.
        self.restore_parser_snapshot(snapshot);
        self.lexer.is_log_disabled = true;
        let _ = trial(self);
        self.lexer.is_log_disabled = false;
    }

    pub(crate) fn skip_type_script_type_parameters_then_open_paren_with_backtracking(
        &mut self,
    ) -> Result<SkipTypeParameterResult, Error> {
        let result =
            self.skip_type_script_type_parameters(TypeParameterFlag::ALLOW_CONST_MODIFIER)?;
        if self.lexer.token != T::TOpenParen {
            return Err(crate::Error::Backtrack);
        }

        Ok(result)
    }

    pub(crate) fn skip_type_script_constraint_of_infer_type_with_backtracking(
        &mut self,
        flags: SkipTypeOptionsBitset,
    ) -> Result<bool, Error> {
        self.lexer.expect(T::TExtends)?;
        // `tryParseConstraintOfInferType`: the constraint is a whole type, and the "?" is looked for after all of it.
        let level = if self.lexer.tolerant {
            Level::Lowest
        } else {
            Level::Prefix
        };
        let constraint_opts =
            SkipTypeOptionsBitset::only(SkipTypeOptions::DisallowConditionalTypes);
        if self.should_keep_types() {
            self.skip_nested_type::<true>(level, constraint_opts)?;
        } else {
            self.skip_type_script_type_with_opts::<false>(level, constraint_opts, None)?;
        }

        if !flags.contains(SkipTypeOptions::DisallowConditionalTypes)
            && self.lexer.token == T::TQuestion
        {
            return Err(crate::Error::Backtrack);
        }

        Ok(true)
    }

    pub(crate) fn skip_type_script_arrow_args_with_backtracking(&mut self) -> Result<bool, Error> {
        self.skip_typescript_fn_args()?;
        if self.lexer.expect(T::TEqualsGreaterThan).is_err() {
            return Err(crate::Error::Backtrack);
        }

        Ok(true)
    }

    pub(crate) fn skip_type_script_type_arguments_with_backtracking(
        &mut self,
    ) -> Result<bool, Error> {
        if self.skip_type_script_type_arguments::<false, true>()? {
            // Check the token after this and backtrack if it's the wrong one
            if !self.can_follow_type_arguments_in_expression() {
                return Err(crate::Error::Backtrack);
            }
        }

        Ok(true)
    }

    pub(crate) fn skip_type_script_arrow_return_type_with_backtracking(
        &mut self,
    ) -> Result<(), Error> {
        self.lexer.expect(T::TColon)?;
        let type_start = self.lexer.loc();

        self.skip_typescript_return_type()?;
        // Check the token after this and backtrack if it's the wrong one
        if self.lexer.token != T::TEqualsGreaterThan || self.lexer.tolerant {
            return self.check_token_after_arrow_return_type(type_start);
        }
        Ok(())
    }

    /// `parseParenthesizedArrowFunctionExpression` without `allowAmbiguity`, after the return type that starts at `type_start`.
    #[cold]
    #[inline(never)]
    fn check_token_after_arrow_return_type(
        &mut self,
        type_start: bun_ast::Loc,
    ) -> Result<(), Error> {
        if self.lexer.tolerant {
            if self.return_type_blocks_arrow_function(type_start) {
                return Err(crate::Error::Backtrack);
            }
            // "(x): T {" is an arrow function that lacks its arrow.
            if self.lexer.token == T::TOpenBrace {
                return Ok(());
            }
        }
        if self.lexer.token != T::TEqualsGreaterThan {
            return Err(crate::Error::Backtrack);
        }
        Ok(())
    }

    /// `typeHasArrowFunctionBlockingParseError`, for the type that was just read from `type_start` on.
    fn return_type_blocks_arrow_function(&mut self, type_start: bun_ast::Loc) -> bool {
        // A missing type has no width.
        if self.lexer.loc() == type_start {
            return true;
        }
        if !self.should_keep_types() {
            return false;
        }
        let syntax = self.type_syntax_mut();
        let mut ty = syntax.last_type;
        while ty.is_some() {
            match syntax.ast[ty].data {
                TypeData::Reference { name, .. } if syntax.ast[name][0].text.slice().is_empty() => {
                    return true;
                }
                TypeData::Function(signature) => ty = syntax.ast[signature].return_type,
                _ => break,
            }
        }
        false
    }

    /// Whether the ":" after a parenthesized expression that sits between the
    /// "?" and ":" of a conditional starts an arrow function return type. The
    /// TypeScript compiler parses the whole arrow function and keeps it only
    /// when another ":" follows its body:
    ///
    ///   x = a ? (b) : c => d;      // "(b)" is an expression, ":" pairs with "?"
    ///   y = a ? (b) : c => d : e;  // "(b) : c => d" is an arrow function
    ///
    /// The body is parsed here and thrown away, then parsed again by the
    /// caller when this returns true. Parsing an expression mutates parser
    /// state, so the whole parser is restored from a snapshot. The current
    /// scope is the arrow's `FunctionArgs` scope; no arguments are declared so
    /// that its members stay untouched. The outcome is memoized by the offset
    /// of the ":" in `ts_conditional_arrow_attempts`, so the real parse does not
    /// repeat the attempts nested inside the body.
    pub(crate) fn is_type_script_arrow_return_type_after_question_and_before_colon(
        &mut self,
        arrow_data: &FnOrArrowDataParse,
    ) -> Result<bool, Error> {
        self.mark_type_script_only();
        debug_assert!(self.lexer.start <= (u32::MAX >> 1) as usize);
        let memo_key = self.lexer.start as u32;
        if let Ok(i) = self
            .ts_conditional_arrow_attempts
            .binary_search_by_key(&memo_key, |&packed| packed >> 1)
        {
            return Ok(self.ts_conditional_arrow_attempts[i] & 1 == 1);
        }

        let snapshot = self.parser_snapshot();
        self.lexer.is_log_disabled = true;

        let mut data = arrow_data.clone();
        let result: Result<(), Error> = (|| {
            self.lexer.expect(T::TColon)?;
            self.skip_typescript_return_type()?;
            self.parse_arrow_body_with_flags(
                &mut [],
                &mut data,
                bun_ast::expr::EFlags::AfterQuestionAndBeforeColon,
            )?;
            // The ":" that pairs with the "?"
            self.lexer.expect(T::TColon)?;
            Ok(())
        })();

        self.restore_parser_snapshot(snapshot);
        let is_arrow_fn = match result {
            Ok(()) => true,
            // Stack and memory exhaustion are not properties of the attempt
            Err(err @ (Error::StackOverflow | Error::Alloc(_))) => return Err(err),
            Err(_) => false,
        };

        // Re-search for the insertion point: attempts nested inside this one may
        // have added entries of their own.
        if let Err(insert_at) = self
            .ts_conditional_arrow_attempts
            .binary_search_by_key(&memo_key, |&packed| packed >> 1)
        {
            self.ts_conditional_arrow_attempts
                .insert(insert_at, (memo_key << 1) | is_arrow_fn as u32);
        }
        Ok(is_arrow_fn)
    }

    // ─────────────────────── try_* wrappers ───────────────────────

    pub(crate) fn try_skip_type_script_type_parameters_then_open_paren_with_backtracking(
        &mut self,
    ) -> SkipTypeParameterResult {
        self.lexer_backtracker_result(
            Self::skip_type_script_type_parameters_then_open_paren_with_backtracking,
        )
    }

    pub(crate) fn try_skip_type_script_type_arguments_with_backtracking(&mut self) -> bool {
        self.lexer_backtracker_bool(Self::skip_type_script_type_arguments_with_backtracking)
    }

    pub(crate) fn try_skip_type_script_arrow_return_type_with_backtracking(&mut self) -> bool {
        self.lexer_backtracker_bool(Self::skip_type_script_arrow_return_type_with_backtracking)
    }

    pub(crate) fn try_skip_type_script_arrow_args_with_backtracking(&mut self) -> bool {
        self.lexer_backtracker_bool(Self::skip_type_script_arrow_args_with_backtracking)
    }

    pub(crate) fn try_skip_type_script_constraint_of_infer_type_with_backtracking(
        &mut self,
        flags: SkipTypeOptionsBitset,
    ) -> bool {
        // The outcome of this attempt depends only on the position of the `extends`
        // token and on whether conditional types are allowed, so an attempt that
        // already backtracked here can be skipped. Each backtracked constraint gets
        // re-parsed by the caller as the `extends` clause of a conditional type,
        // which repeats the attempts nested inside it; without the memo that's
        // exponential for deeply nested `infer X extends` constraints inside
        // template literal types (found by fuzzing).
        //
        // Token offsets fit in 31 bits (`Loc` is an `i32`), so the offset and the
        // flag bit pack into a `u32`.
        debug_assert!(self.lexer.start <= (u32::MAX >> 1) as usize);
        let memo_key = ((self.lexer.start as u32) << 1)
            | flags.contains(SkipTypeOptions::DisallowConditionalTypes) as u32;
        if self
            .ts_infer_constraint_backtracks
            .binary_search(&memo_key)
            .is_ok()
        {
            return false;
        }

        let skipped = self.lexer_backtracker_bool(|p| {
            p.skip_type_script_constraint_of_infer_type_with_backtracking(flags)
        });
        if !skipped {
            // Re-search for the insertion point: attempts nested inside the one that
            // just failed may have added entries of their own.
            if let Err(insert_at) = self.ts_infer_constraint_backtracks.binary_search(&memo_key) {
                self.ts_infer_constraint_backtracks
                    .insert(insert_at, memo_key);
            }
        }
        skipped
    }
}
