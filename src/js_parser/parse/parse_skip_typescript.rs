#![warn(unused_must_use)]
use crate::Error;
use crate::lexer::LexerSnapshot;
use crate::lexer::T;
use crate::p::P;
use crate::parse::type_sink::{
    ConstDefault, DecoratorMetadata, Discard, KK, Operand, TypeKeyword, TypeLiteral, TypeSink, b,
};
use crate::parser::{
    FnOrArrowDataParse, ParseStatementOptions, SkipTypeParameterResult, TypeParameterFlag,
};
use crate::typescript;
use crate::typescript::SkipTypeOptions;
use crate::typescript::identifier::{Kind as TsIdentKind, kind_for_identifier};
use bun_ast::op::Level;
use bun_ast::ts;
use bun_ast::ts::Metadata;

// Re-export so the parser-side type alias used in this file matches the
// canonical definition in `TypeScript.rs`.
pub(crate) type SkipTypeOptionsBitset = typescript::SkipTypeOptionsBitset;

bun_core::comptime_string_map! {
    static MEMBER_KEYWORD_MAP: MemberKeyword = {
        b"get" => MemberKeyword::Accessor,
        b"set" => MemberKeyword::Accessor,
        b"static" => MemberKeyword::Static,
        b"abstract" => MemberKeyword::Modifier,
        b"accessor" => MemberKeyword::Modifier,
        b"async" => MemberKeyword::Modifier,
        b"declare" => MemberKeyword::Modifier,
        b"out" => MemberKeyword::Modifier,
        b"override" => MemberKeyword::Modifier,
        b"private" => MemberKeyword::Modifier,
        b"protected" => MemberKeyword::Modifier,
        b"public" => MemberKeyword::Modifier,
        b"readonly" => MemberKeyword::Modifier,
    };
}

/// A word that is no reserved word and that parseTypeMember tests for.
#[derive(Clone, Copy)]
pub(crate) enum MemberKeyword {
    /// "get" and "set".
    Accessor,
    /// "static": a modifier once, then a name.
    Static,
    /// A modifier that its successor must follow on the same line.
    Modifier,
}

/// How the modifiers of a member ended.
enum AfterModifiers {
    /// The lexer is on the first token after them.
    Member,
    /// A word that may be a modifier was read and is the name of the member.
    Name,
    /// "get" or "set" was read and a name follows.
    Accessor,
}

/// What of a member was read before its signature or type annotation.
#[derive(Clone, Copy, PartialEq, Eq)]
enum MemberName {
    /// Nothing, as in a call signature.
    None,
    /// A word, a string or a number.
    Word,
    /// "[" to "]" with a type between them.
    Bracket,
    /// "[" to "]" with an index signature or the head of a mapped type between them.
    Index,
}

/// What `P::parse_bracketed_name` read between "[" and "]".
#[derive(Clone, Copy)]
enum Bracketed {
    /// A type, which stands for a name.
    Type,
    /// A type with ": type" or "in type as type" after it, or a sign after the "]".
    TypeWithIndex,
    /// The expression of parseComputedPropertyName.
    Expression,
    /// The parameters of parseIndexSignatureDeclaration.
    Parameters,
}

/// What `P::parse_and_drop_in_type` reads.
#[derive(Clone, Copy)]
enum Dropped {
    /// The expression of parseComputedPropertyName.
    ComputedPropertyName,
    /// The expression of parseInitializer.
    Initializer,
    /// The expression of parseExpressionWithTypeArguments.
    LeftHandSide,
    /// The block of parseFunctionBlockOrSemicolon.
    FunctionBlock,
}

/// The lexer and the log before a reading that another reading may replace.
struct ReadMark<'a> {
    lexer: LexerSnapshot<'a>,
    msgs_len: usize,
    errors: u32,
    warnings: u32,
}

/// What a reading that failed left: the lexer after it and what it logged.
struct FailedRead<'a> {
    lexer: LexerSnapshot<'a>,
    msgs: Vec<bun_ast::Msg>,
    errors: u32,
    warnings: u32,
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    #[inline]
    pub(crate) fn skip_typescript_return_type(&mut self) -> Result<(), Error> {
        // "function f(keyof: any): keyof is string"
        if self.lexer.token == T::TIdentifier
            && self.is_followed_by_is_keyword()
            && self.skip_type_script_predicate_of_keyword_name()?
        {
            return Ok(());
        }
        self.skip_type_script_type_with_opts::<Discard>(
            Level::Lowest,
            SkipTypeOptionsBitset::only(SkipTypeOptions::IsReturnType),
            &mut (),
        )
    }

    #[inline]
    pub(crate) fn skip_typescript_return_type_with_metadata(&mut self) -> Result<Metadata, Error> {
        // tsc serializes a predicate without "asserts" as Boolean
        if self.lexer.token == T::TIdentifier
            && self.is_followed_by_is_keyword()
            && self.skip_type_script_predicate_of_keyword_name()?
        {
            return Ok(Metadata::MBoolean);
        }
        let mut result = Metadata::DEFAULT;
        self.skip_type_script_type_with_opts::<DecoratorMetadata>(
            Level::Lowest,
            SkipTypeOptionsBitset::only(SkipTypeOptions::IsReturnType),
            &mut result,
        )?;
        Ok(result)
    }

    #[inline]
    pub(crate) fn skip_type_script_type(&mut self, level: Level) -> Result<(), Error> {
        self.mark_type_script_only();
        self.skip_type_script_type_with_opts::<Discard>(
            level,
            SkipTypeOptionsBitset::empty(),
            &mut (),
        )
    }

    #[inline]
    pub(crate) fn skip_type_script_type_with_metadata(
        &mut self,
        level: Level,
    ) -> Result<Metadata, Error> {
        self.mark_type_script_only();
        let mut result = Metadata::DEFAULT;
        self.skip_type_script_type_with_opts::<DecoratorMetadata>(
            level,
            SkipTypeOptionsBitset::empty(),
            &mut result,
        )?;
        Ok(result)
    }

    /// Whether the word "is" and a blank follow the current token on its line.
    #[inline]
    fn is_followed_by_is_keyword(&self) -> bool {
        let contents = self.lexer.contents;
        let mut i = self.lexer.end;
        while matches!(contents.get(i), Some(b' ' | b'\t')) {
            i += 1;
        }
        matches!(contents.get(i..i + 3), Some([b'i', b's', b' ' | b'\t']))
    }

    /// At the first word of a return type, which "is" follows. Reads `word is T` where the word is the name of a type operator and `T` starts on the same line.
    #[cold]
    #[inline(never)]
    fn skip_type_script_predicate_of_keyword_name(&mut self) -> Result<bool, Error> {
        let is_asserts = match kind_for_identifier(self.lexer.identifier) {
            Some(TsIdentKind::PrefixKeyof | TsIdentKind::PrefixReadonly | TsIdentKind::Infer) => {
                false
            }
            Some(TsIdentKind::Asserts) => true,
            _ => return Ok(false),
        };

        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        self.lexer.is_log_disabled = true;
        // "asserts is is T" stays the assertion about a parameter named "is"
        let is_predicate = self.lexer.next().is_ok()
            && self.lexer.is_contextual_keyword(b"is")
            && !self.lexer.has_newline_before
            && self.lexer.next().is_ok()
            && self.is_start_of_predicate_type()
            && !(is_asserts && self.lexer.is_contextual_keyword(b"is"));
        self.lexer.restore(&old_lexer);
        self.lexer.is_log_disabled = old_log_disabled;
        if !is_predicate {
            return Ok(false);
        }

        self.lexer.next()?;
        self.lexer.next()?;
        self.skip_type_script_type(Level::Lowest)?;
        Ok(true)
    }

    /// At "is" on a new line after `asserts x`. Reads `is T` where `T` starts on the line of "is".
    #[cold]
    #[inline(never)]
    fn skip_type_script_predicate_type_after_newline(&mut self) -> Result<bool, Error> {
        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        self.lexer.is_log_disabled = true;
        let is_predicate = self.lexer.next().is_ok() && self.is_start_of_predicate_type();
        self.lexer.restore(&old_lexer);
        self.lexer.is_log_disabled = old_log_disabled;
        if !is_predicate {
            return Ok(false);
        }

        self.lexer.next()?;
        self.skip_type_script_type(Level::Lowest)?;
        Ok(true)
    }

    /// After "is": whether the current token is on the line of "is", starts a type and continues no expression and no type.
    fn is_start_of_predicate_type(&self) -> bool {
        if self.lexer.has_newline_before {
            return false;
        }
        match self.lexer.token {
            T::TIdentifier => {
                !self.lexer.is_contextual_keyword(b"as")
                    && !self.lexer.is_contextual_keyword(b"satisfies")
            }
            T::TStringLiteral
            | T::TNumericLiteral
            | T::TBigIntegerLiteral
            | T::TTrue
            | T::TFalse
            | T::TNull
            | T::TVoid
            | T::TThis
            | T::TTypeof
            | T::TNew
            | T::TImport => true,
            _ => false,
        }
    }

    pub(crate) fn skip_type_script_binding(&mut self) -> Result<(), Error> {
        self.mark_type_script_only();
        // Nested destructuring patterns in skipped type positions recurse through
        // this function; bound it like `parse_binding` does.
        if !self.stack_check.is_safe_to_recurse() {
            return Err(crate::Error::StackOverflow);
        }
        match self.lexer.token {
            T::TIdentifier | T::TThis => {
                self.lexer.next()?;
            }
            T::TOpenBracket => {
                self.lexer.next()?;

                // "[, , a]"
                while self.lexer.token == T::TComma {
                    self.lexer.next()?;
                }
                // "[a, b]"
                while self.lexer.token != T::TCloseBracket {
                    // "[...a]"
                    if self.lexer.token == T::TDotDotDot {
                        self.lexer.next()?;
                    }

                    self.skip_type_script_binding()?;

                    // "[a = 1]"
                    if self.lexer.token == T::TEquals {
                        self.parse_initializer_in_type()?;
                    }

                    if self.lexer.token != T::TComma {
                        break;
                    }
                    self.lexer.next()?;

                    // "[a, , b]": inside an attempt the second comma ends the attempt, as before
                    while self.lexer.token == T::TComma && !self.lexer.is_log_disabled {
                        self.lexer.next()?;
                    }
                }

                self.lexer.expect(T::TCloseBracket)?;
            }
            T::TOpenBrace => {
                self.lexer.next()?;

                while self.lexer.token != T::TCloseBrace {
                    let mut found_identifier = false;

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
                            self.lexer.next()?;
                        }

                        // "{1: y}"
                        // "{'x': y}"
                        T::TStringLiteral | T::TNumericLiteral => {
                            self.lexer.next()?;
                        }

                        _ => {
                            if self.lexer.is_identifier_or_keyword() {
                                // "{if: x}"
                                self.lexer.next()?;
                            } else if !self.skip_type_script_signature_property_name()? {
                                self.lexer.unexpected()?;
                            }
                        }
                    }

                    if self.lexer.token == T::TColon || !found_identifier {
                        self.lexer.expect(T::TColon)?;
                        self.skip_type_script_binding()?;
                    }

                    // "{a = 1}"
                    if self.lexer.token == T::TEquals {
                        self.parse_initializer_in_type()?;
                    }

                    if self.lexer.token != T::TComma {
                        break;
                    }

                    self.lexer.next()?;
                }

                self.lexer.expect(T::TCloseBrace)?;
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

        self.lexer.expect(T::TOpenParen)?;

        while self.lexer.token != T::TCloseParen {
            // "(...a)"
            if self.lexer.token == T::TDotDotDot {
                self.lexer.next()?;
            }

            let is_identifier = self.lexer.token == T::TIdentifier;
            let name = self.lexer.identifier;
            self.skip_type_script_binding()?;

            // "(public a)"
            if is_identifier && self.lexer.token == T::TIdentifier {
                self.skip_type_script_parameter_modifiers(name)?;
            }

            // "(a?)"
            if self.lexer.token == T::TQuestion {
                self.lexer.next()?;
            }

            // "(a: any)"
            if self.lexer.token == T::TColon {
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
            }

            // "(a = 1)"
            if self.lexer.token == T::TEquals {
                self.parse_initializer_in_type()?;
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

    /// After a name that a second name follows. Where the first is a modifier of a parameter property, reads on to the name of the parameter.
    #[cold]
    #[inline(never)]
    fn skip_type_script_parameter_modifiers(&mut self, first: &'a [u8]) -> Result<(), Error> {
        // Inside an attempt the second name ends the attempt, as before.
        if self.lexer.is_log_disabled {
            return Ok(());
        }
        let mut name = first;
        while crate::lexer::is_type_script_accessibility_modifier(name)
            && self.lexer.token == T::TIdentifier
            && !self.lexer.has_newline_before
        {
            name = self.lexer.identifier;
            self.lexer.next()?;
        }
        Ok(())
    }

    /// At a token that starts no property name of a binding pattern read before. True where it read a bigint or `[expression]`.
    #[cold]
    #[inline(never)]
    fn skip_type_script_signature_property_name(&mut self) -> Result<bool, Error> {
        // Inside an attempt the token ends the attempt, as before.
        if self.lexer.is_log_disabled {
            return Ok(false);
        }
        match self.lexer.token {
            T::TBigIntegerLiteral => {
                self.lexer.next()?;
                Ok(true)
            }
            T::TOpenBracket => {
                let mark = self.read_mark();
                match self.parse_computed_property_name() {
                    Ok(()) if self.log().errors == mark.errors => Ok(true),
                    Err(err @ (Error::StackOverflow | Error::Alloc(_))) => Err(err),
                    _ => {
                        self.rewind_to_read_mark(&mark);
                        Ok(false)
                    }
                }
            }
            _ => Ok(false),
        }
    }

    /// The flag kept for the token at `offset`: for "(", whether a reading outside an attempt found a function type there.
    #[inline]
    fn type_script_memo_at(&self, offset: usize) -> Option<bool> {
        if self.ts_conditional_arrow_attempts.is_empty() {
            return None;
        }
        let key = offset as u32;
        self.ts_conditional_arrow_attempts
            .binary_search_by_key(&key, |&entry| entry >> 1)
            .ok()
            .and_then(|i| self.ts_conditional_arrow_attempts.get(i))
            .map(|&entry| entry & 1 == 1)
    }

    /// Keeps `flag` for the token at `offset`. The list is the one of the ":" offsets: no ":" starts where a "(" or a "=>" does.
    #[cold]
    #[inline(never)]
    fn set_type_script_memo_at(&mut self, offset: usize, flag: bool) {
        debug_assert!(offset <= (u32::MAX >> 1) as usize);
        let key = offset as u32;
        let packed = (key << 1) | flag as u32;
        match self
            .ts_conditional_arrow_attempts
            .binary_search_by_key(&key, |&entry| entry >> 1)
        {
            Ok(i) => {
                if let Some(entry) = self.ts_conditional_arrow_attempts.get_mut(i) {
                    *entry = packed;
                }
            }
            Err(insert_at) => self.ts_conditional_arrow_attempts.insert(insert_at, packed),
        }
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
    pub(crate) fn skip_type_script_paren_or_fn_type<S: TypeSink>(
        &mut self,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        self.mark_type_script_only();

        if self.try_skip_type_script_arrow_args_with_backtracking() {
            self.skip_typescript_return_type()?;
            S::function_type(out);
            return Ok(());
        }

        // Inside an attempt no other reading is tried, so that no attempt ends differently than before.
        if self.lexer.is_log_disabled {
            return self.skip_type_script_paren_type::<S>(out);
        }

        let mark = self.read_mark();
        // Where the expression around this type is read twice, the second reading starts with what the first found
        let known = self.type_script_memo_at(mark.lexer.start);
        if known == Some(true) && self.skip_known_type_script_fn_type(&mark)? {
            S::function_type(out);
            return Ok(());
        }
        let result = self.skip_type_script_paren_type::<S>(out);
        if known.is_some() || matches!(result, Err(Error::StackOverflow | Error::Alloc(_))) {
            return result;
        }
        // "=>" after the ")" is an error, but for the arrow that a conditional expression was read with
        let is_before_arrow = self.lexer.token == T::TEqualsGreaterThan
            && self.type_script_memo_at(self.lexer.start).is_none();
        if result.is_ok() && self.log().errors == mark.errors && !is_before_arrow {
            return result;
        }

        // "(a = 1) => void"
        if self.reread_type_script_fn_type(&mark)? {
            S::function_type(out);
            return Ok(());
        }
        result
    }

    /// `(type)`
    #[inline]
    fn skip_type_script_paren_type<S: TypeSink>(&mut self, out: &mut S::Out) -> Result<(), Error> {
        self.lexer.expect(T::TOpenParen)?;
        let mut inner = S::Out::default();
        self.mark_type_script_only();
        self.skip_type_script_type_with_opts::<S>(
            Level::Lowest,
            SkipTypeOptionsBitset::empty(),
            &mut inner,
        )?;
        S::parenthesized(out, inner);
        self.lexer.expect(T::TCloseParen)?;
        Ok(())
    }

    /// The type in parentheses at `mark` was read with an error, or "=>" follows it. True where `(parameters) => type` is read there instead, else what that reading left stays.
    #[cold]
    #[inline(never)]
    fn reread_type_script_fn_type(&mut self, mark: &ReadMark<'a>) -> Result<bool, Error> {
        let failed = self.set_aside_failed_read(mark);
        let reread = self.skip_type_script_fn_type_signature();
        if let Err(err @ (Error::StackOverflow | Error::Alloc(_))) = reread {
            return Err(err);
        }
        let is_fn_type = reread.is_ok() && self.log().errors == mark.errors;
        self.set_type_script_memo_at(mark.lexer.start, is_fn_type);
        if !is_fn_type {
            // Neither reading fits: the errors stay the ones of the first.
            self.restore_failed_read(mark, failed);
        }
        Ok(is_fn_type)
    }

    /// A reading before this one found `(parameters) => type` at `mark`. False where it is none now: nothing moved then.
    #[cold]
    #[inline(never)]
    fn skip_known_type_script_fn_type(&mut self, mark: &ReadMark<'a>) -> Result<bool, Error> {
        let reread = self.skip_type_script_fn_type_signature();
        if let Err(err @ (Error::StackOverflow | Error::Alloc(_))) = reread {
            return Err(err);
        }
        if reread.is_ok() && self.log().errors == mark.errors {
            return Ok(true);
        }
        // The flags of the parser are not the ones of that reading.
        self.rewind_to_read_mark(mark);
        self.set_type_script_memo_at(mark.lexer.start, false);
        Ok(false)
    }

    /// `(parameters) => type`
    fn skip_type_script_fn_type_signature(&mut self) -> Result<(), Error> {
        self.skip_typescript_fn_args()?;
        if self.lexer.token != T::TEqualsGreaterThan {
            return Err(Error::Backtrack);
        }
        self.lexer.next()?;
        self.skip_typescript_return_type()
    }

    /// Every caller reads a whole type: `level` is `Level::Lowest`.
    pub(crate) fn skip_type_script_type_with_opts<S: TypeSink>(
        &mut self,
        level: Level,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        debug_assert_eq!(level, Level::Lowest);
        self.parse_type::<S>(opts, out)
    }

    /// `parseType` of typescript-go's parser.go. `opts` is the context that it keeps in flags.
    fn parse_type<S: TypeSink>(
        &mut self,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        self.mark_type_script_only();

        if !self.stack_check.is_safe_to_recurse() {
            return Err(Error::StackOverflow);
        }

        if self.is_start_of_function_type_or_constructor_type() {
            self.parse_function_or_constructor_type::<S>(opts, out)?;
            // Where a parenthesized type was read, operators follow it as they follow every other type.
            let mut lead: KK<S, b::Lead> = ConstDefault::DEFAULT;
            self.parse_union_or_intersection_type_rest::<S, false>(opts, out, &mut lead)?;
            self.parse_union_or_intersection_type_rest::<S, true>(opts, out, &mut lead)?;
        } else {
            self.parse_union_type_or_higher::<S>(opts, out)?;
        }

        if self.lexer.token == T::TExtends
            && !self.lexer.has_newline_before
            && !opts.contains(SkipTypeOptions::DisallowConditionalTypes)
        {
            self.parse_conditional_type_rest::<S>(out)?;
        }
        Ok(())
    }

    /// The conditional type of `parseType`, from its "extends" on. `out` holds the check type.
    fn parse_conditional_type_rest<S: TypeSink>(&mut self, out: &mut S::Out) -> Result<(), Error> {
        self.lexer.next()?;
        let mut check_type = <S::Sub as TypeSink>::NONE;
        let mut extends_type = <S::Sub as TypeSink>::NONE;
        let mut true_type = <S::Sub as TypeSink>::NONE;
        if S::BUILDS {
            check_type = S::b_take(out);
        }

        // The type following "extends" is not permitted to be another conditional type
        {
            let mut extends_out = S::Out::default();
            self.parse_type::<S>(
                SkipTypeOptionsBitset::only(SkipTypeOptions::DisallowConditionalTypes),
                &mut extends_out,
            )?;
            if S::BUILDS {
                extends_type = S::node(&extends_out);
            }
        }

        self.lexer.expect(T::TQuestion)?;
        let mut when_true = S::Out::default();
        self.parse_type::<S>(SkipTypeOptionsBitset::empty(), &mut when_true)?;
        if S::BUILDS {
            true_type = S::node(&when_true);
        }
        self.lexer.expect(T::TColon)?;
        match S::conditional_true(out, when_true, |r| self.load_name_from_ref(r)) {
            Operand::Decided => {
                self.parse_type::<Discard>(SkipTypeOptionsBitset::empty(), &mut ())?;
            }
            Operand::Open(left) => {
                self.parse_type::<S>(SkipTypeOptionsBitset::empty(), out)?;
                S::conditional_false(out, left);
                if S::BUILDS {
                    S::b_conditional(&self.lexer, out, check_type, extends_type, true_type);
                }
            }
        }
        Ok(())
    }

    /// `parseUnionTypeOrHigher`
    #[inline]
    fn parse_union_type_or_higher<S: TypeSink>(
        &mut self,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        self.parse_union_or_intersection_type::<S, true>(opts, out)
    }

    /// `parseIntersectionTypeOrHigher`
    #[inline]
    fn parse_intersection_type_or_higher<S: TypeSink>(
        &mut self,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        self.parse_union_or_intersection_type::<S, false>(opts, out)
    }

    /// `parseUnionOrIntersectionType`. `IS_UNION` selects the operator and the constituent.
    fn parse_union_or_intersection_type<S: TypeSink, const IS_UNION: bool>(
        &mut self,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        let mut lead: KK<S, b::Lead> = ConstDefault::DEFAULT;
        let has_leading_operator =
            self.lexer.token == if IS_UNION { T::TBar } else { T::TAmpersand };
        if has_leading_operator {
            if S::BUILDS {
                S::b_leading(&self.lexer, &mut lead);
            }
            self.lexer.next()?;
            self.parse_function_or_constructor_type_to_error::<S, IS_UNION>(opts, out)?;
        } else {
            self.parse_constituent_type::<S, IS_UNION>(opts, out)?;
        }
        self.parse_union_or_intersection_type_rest::<S, IS_UNION>(opts, out, &mut lead)
    }

    /// The loop of `parseUnionOrIntersectionType`: the constituents after the first one.
    fn parse_union_or_intersection_type_rest<S: TypeSink, const IS_UNION: bool>(
        &mut self,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
        lead: &mut KK<S, b::Lead>,
    ) -> Result<(), Error> {
        let mut set: KK<S, b::Set> = ConstDefault::DEFAULT;
        let operator = if IS_UNION { T::TBar } else { T::TAmpersand };
        while self.lexer.token == operator {
            self.lexer.next()?;
            let left = if IS_UNION {
                S::union_left(out, |r| self.load_name_from_ref(r))
            } else {
                S::intersection_left(out, |r| self.load_name_from_ref(r))
            };
            match left {
                Operand::Decided => {
                    self.parse_function_or_constructor_type_to_error::<Discard, IS_UNION>(
                        opts,
                        &mut (),
                    )?;
                }
                Operand::Open(left) => {
                    if S::BUILDS {
                        S::b_operand(&self.lexer, out, &mut set, lead, IS_UNION);
                    }
                    self.parse_function_or_constructor_type_to_error::<S, IS_UNION>(opts, out)?;
                    if S::BUILDS {
                        S::b_operand_end(out, &mut set);
                    }
                    if IS_UNION {
                        S::union_right(out, left);
                    } else {
                        S::intersection_right(out, left);
                    }
                }
            }
        }
        if S::BUILDS {
            S::b_finish(&self.lexer, out, &mut set, lead);
        }
        Ok(())
    }

    /// `parseIntersectionTypeOrHigher` for a union, `parseTypeOperatorOrHigher` for an intersection.
    #[inline]
    fn parse_constituent_type<S: TypeSink, const IS_UNION: bool>(
        &mut self,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        if IS_UNION {
            self.parse_intersection_type_or_higher::<S>(opts, out)
        } else {
            self.parse_type_operator_or_higher::<S>(opts, out)
        }
    }

    /// `parseFunctionOrConstructorTypeToError`. Only a lint parse reports the missing parentheses.
    fn parse_function_or_constructor_type_to_error<S: TypeSink, const IS_UNION: bool>(
        &mut self,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        if self.is_start_of_function_type_or_constructor_type() {
            self.parse_function_or_constructor_type::<S>(opts, out)?;
            if IS_UNION {
                let mut lead: KK<S, b::Lead> = ConstDefault::DEFAULT;
                self.parse_union_or_intersection_type_rest::<S, false>(opts, out, &mut lead)?;
            }
            return Ok(());
        }
        self.parse_constituent_type::<S, IS_UNION>(opts, out)
    }

    /// `parseTypeOperatorOrHigher`
    fn parse_type_operator_or_higher<S: TypeSink>(
        &mut self,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        let kind = match self.lexer.token {
            T::TIdentifier => {
                kind_for_identifier(self.lexer.identifier).unwrap_or(TsIdentKind::Normal)
            }
            T::TBar | T::TAmpersand => {
                return self.parse_type_after_leading_operators::<S>(opts, out);
            }
            _ => TsIdentKind::Normal,
        };
        match kind {
            TsIdentKind::PrefixKeyof | TsIdentKind::PrefixReadonly | TsIdentKind::Unique => {
                self.parse_type_operator::<S>(kind, opts, out)
            }
            TsIdentKind::Infer => self.parse_infer_type::<S>(opts, out),
            _ => self.parse_postfix_type_or_higher::<S>(kind, opts, out),
        }
    }

    /// A parse without lint takes any run of "|" and "&" in front of a type, as before.
    #[cold]
    fn parse_type_after_leading_operators<S: TypeSink>(
        &mut self,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        let mut lead: KK<S, b::Lead> = ConstDefault::DEFAULT;
        let mut set: KK<S, b::Set> = ConstDefault::DEFAULT;
        while matches!(self.lexer.token, T::TBar | T::TAmpersand) {
            if S::BUILDS {
                S::b_leading(&self.lexer, &mut lead);
            }
            self.lexer.next()?;
        }
        if self.is_start_of_function_type_or_constructor_type() {
            self.parse_function_or_constructor_type::<S>(opts, out)?;
        } else {
            self.parse_type_operator_or_higher::<S>(opts, out)?;
        }
        if S::BUILDS {
            S::b_finish(&self.lexer, out, &mut set, &mut lead);
        }
        Ok(())
    }

    /// `parseTypeOperator`. `operator` is "keyof", "readonly" or "unique", which the lexer is on.
    fn parse_type_operator<S: TypeSink>(
        &mut self,
        operator: TsIdentKind,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(Error::StackOverflow);
        }
        let mut start: KK<S, u32> = ConstDefault::DEFAULT;
        let mut operand = <S::Sub as TypeSink>::NONE;
        if S::BUILDS {
            start = S::b_start(&self.lexer);
        }

        if operator == TsIdentKind::Unique {
            if S::BUILDS {
                S::b_reference(&self.lexer, out);
            }
            self.lexer.next()?;

            // "unique symbol", where what follows "symbol" belongs to the operand
            if self.lexer.is_contextual_keyword(b"symbol") {
                if S::BUILDS {
                    <S::Sub as TypeSink>::b_token(&mut self.lexer, &mut operand)?;
                }
                self.lexer.next()?;
                self.parse_postfix_type_rest::<S::Sub>(&mut operand)?;
                if S::BUILDS {
                    S::b_operator(
                        &self.lexer,
                        out,
                        &start,
                        ts::TypeOperatorKind::Unique,
                        operand,
                    );
                }
                return Ok(());
            }
            // Without "symbol" after it, "unique" is a name, as before.
            if !self.parse_type_predicate_after_name::<S>(out)? {
                self.parse_type_arguments_of_type_reference::<S>(out)?;
            }
            return self.parse_postfix_type_rest::<S>(out);
        }

        self.lexer.next()?;
        if !self.is_type_operator_a_name(opts) {
            // A function type is taken as the operand, as before.
            if self.is_start_of_function_type_or_constructor_type() {
                self.parse_function_or_constructor_type::<S::Sub>(
                    SkipTypeOptionsBitset::empty(),
                    &mut operand,
                )?;
            } else {
                self.parse_type_operator_or_higher::<S::Sub>(
                    SkipTypeOptionsBitset::empty(),
                    &mut operand,
                )?;
            }
            // Where no conditional type may follow, it is still read as part of the operand, as before.
            if !S::STRICT
                && opts.contains(SkipTypeOptions::DisallowConditionalTypes)
                && self.lexer.token == T::TExtends
                && !self.lexer.has_newline_before
            {
                self.parse_conditional_type_rest::<S::Sub>(&mut operand)?;
            }
        }

        if operator == TsIdentKind::PrefixKeyof {
            S::keyof_type(out);
            if S::BUILDS {
                S::b_operator(
                    &self.lexer,
                    out,
                    &start,
                    ts::TypeOperatorKind::KeyOf,
                    operand,
                );
            }
        } else {
            S::readonly_type(out);
            if S::BUILDS {
                S::b_operator(
                    &self.lexer,
                    out,
                    &start,
                    ts::TypeOperatorKind::Readonly,
                    operand,
                );
            }
        }
        Ok(())
    }

    /// Whether "keyof", "readonly" or "infer" was a name: the key of an index signature, a tuple label.
    #[inline]
    fn is_type_operator_a_name(&self, opts: SkipTypeOptionsBitset) -> bool {
        matches!(self.lexer.token, T::TColon | T::TQuestion | T::TIn)
            && (opts.contains(SkipTypeOptions::IsIndexSignature)
                || opts.contains(SkipTypeOptions::AllowTupleLabels))
    }

    /// `parseInferType`
    fn parse_infer_type<S: TypeSink>(
        &mut self,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        let mut start: KK<S, u32> = ConstDefault::DEFAULT;
        let mut name: KK<S, Option<ts::Name>> = ConstDefault::DEFAULT;
        let mut constraint = <S::Sub as TypeSink>::NONE;
        if S::BUILDS {
            start = S::b_start(&self.lexer);
        }
        self.lexer.next()?;

        if !self.is_type_operator_a_name(opts) {
            // parseTypeParameterOfInferType
            if S::BUILDS {
                name = S::b_ident(&self.lexer);
            }
            self.lexer.expect(T::TIdentifier)?;
            if self.lexer.token == T::TExtends {
                (_, constraint) = self
                    .try_skip_type_script_constraint_of_infer_type_with_backtracking::<S::Sub>(
                        opts,
                    )?;
            }
        }
        if S::BUILDS {
            S::b_infer(&self.lexer, out, &start, name, constraint);
        }

        // "[]" and the like are read after "infer U", as before.
        self.parse_postfix_type_rest::<S>(out)
    }

    /// `parsePostfixTypeOrHigher`. `kind` is the kind of the identifier that the lexer is on.
    #[inline]
    fn parse_postfix_type_or_higher<S: TypeSink>(
        &mut self,
        kind: TsIdentKind,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        self.parse_non_array_type::<S>(kind, opts, out)?;
        self.parse_postfix_type_rest::<S>(out)
    }

    /// The loop of `parsePostfixTypeOrHigher`. Its "?" is read in `parse_tuple_element_type` only.
    fn parse_postfix_type_rest<S: TypeSink>(&mut self, out: &mut S::Out) -> Result<(), Error> {
        loop {
            match self.lexer.token {
                T::TExclamation => {
                    // The "!" of a JSDoc type must be read for "as" casts to go on after it.
                    if self.lexer.has_newline_before {
                        return Ok(());
                    }

                    if S::BUILDS {
                        S::b_non_null(&self.lexer, out);
                    }
                    self.lexer.next()?;
                }
                T::TOpenBracket => {
                    // "{ ['x']: string \n ['y']: string }" must not become a single type
                    if self.lexer.has_newline_before {
                        return Ok(());
                    }
                    self.lexer.next()?;
                    let has_index_type = self.lexer.token != T::TCloseBracket;
                    let mut index = <S::Sub as TypeSink>::NONE;
                    if has_index_type {
                        self.parse_type::<S::Sub>(SkipTypeOptionsBitset::empty(), &mut index)?;
                    }
                    if S::BUILDS {
                        S::b_index(&self.lexer, out, index);
                    }
                    self.lexer.expect(T::TCloseBracket)?;

                    S::index_or_array(out, has_index_type);
                }
                T::TDot => {
                    // ".name" is read after every type, as before.
                    self.lexer.next()?;
                    self.parse_right_side_of_dot::<S>(out)?;

                    // "{ <A extends B>(): c.d \n <E extends F>(): g.h }" must not become a single type
                    self.parse_type_arguments_of_type_reference::<S>(out)?;
                }
                _ => return Ok(()),
            }
        }
    }

    /// `parseNonArrayType`. `kind` is the kind of the identifier that the lexer is on.
    fn parse_non_array_type<S: TypeSink>(
        &mut self,
        kind: TsIdentKind,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        match self.lexer.token {
            T::TIdentifier => {
                let keyword = match kind {
                    TsIdentKind::PrimitiveAny => TypeKeyword::Any,
                    TsIdentKind::PrimitiveNever => TypeKeyword::Never,
                    TsIdentKind::PrimitiveUnknown => TypeKeyword::Unknown,
                    TsIdentKind::PrimitiveUndefined => TypeKeyword::Undefined,
                    TsIdentKind::PrimitiveObject => TypeKeyword::Object,
                    TsIdentKind::PrimitiveNumber => TypeKeyword::Number,
                    TsIdentKind::PrimitiveString => TypeKeyword::String,
                    TsIdentKind::PrimitiveBoolean => TypeKeyword::Boolean,
                    TsIdentKind::PrimitiveBigint => TypeKeyword::Bigint,
                    TsIdentKind::PrimitiveSymbol => TypeKeyword::Symbol,
                    TsIdentKind::Asserts => {
                        return self.parse_asserts_type_predicate::<S>(opts, out);
                    }
                    _ => return self.parse_type_reference::<S>(kind, opts, out),
                };
                self.parse_keyword_type_node::<S>(keyword, out)
            }
            T::TNumericLiteral => self.parse_literal_type_node::<S>(TypeLiteral::Number, out),
            T::TBigIntegerLiteral => self.parse_literal_type_node::<S>(TypeLiteral::Bigint, out),
            T::TStringLiteral | T::TNoSubstitutionTemplateLiteral => {
                self.parse_literal_type_node::<S>(TypeLiteral::String, out)
            }
            T::TTrue | T::TFalse => self.parse_literal_type_node::<S>(TypeLiteral::Boolean, out),
            T::TNull => {
                if S::BUILDS {
                    S::b_token(&mut self.lexer, out)?;
                }
                self.lexer.next()?;
                S::keyword(out, TypeKeyword::Null);
                Ok(())
            }
            T::TVoid => {
                if S::BUILDS {
                    S::b_token(&mut self.lexer, out)?;
                }
                self.lexer.next()?;
                S::keyword(out, TypeKeyword::Void);
                Ok(())
            }
            T::TMinus => {
                // "-123" and "-123n"
                let mut start: KK<S, u32> = ConstDefault::DEFAULT;
                if S::BUILDS {
                    start = S::b_start(&self.lexer);
                }
                self.lexer.next()?;
                if S::BUILDS {
                    S::b_negative(&mut self.lexer, out, &start)?;
                }

                if self.lexer.token == T::TBigIntegerLiteral {
                    self.lexer.next()?;
                    S::literal(out, TypeLiteral::Bigint);
                } else {
                    self.lexer.expect(T::TNumericLiteral)?;
                    S::literal(out, TypeLiteral::Number);
                }
                Ok(())
            }
            T::TThis => {
                if S::BUILDS {
                    S::b_token(&mut self.lexer, out)?;
                }
                self.lexer.next()?;

                // "function check(): this is boolean"
                if !self.parse_type_predicate_after_name::<S>(out)? {
                    S::keyword(out, TypeKeyword::This);
                }
                Ok(())
            }
            T::TTypeof => self.parse_type_query::<S>(opts, out),
            T::TOpenBrace if S::BUILDS => {
                let node = self.build_type_script_object_type()?;
                S::b_node(out, node);
                Ok(())
            }
            T::TOpenBrace => {
                self.skip_type_script_object_type()?;
                S::object_type(out);
                Ok(())
            }
            T::TOpenBracket if S::BUILDS => {
                let node = self.build_type_script_tuple_type()?;
                S::b_node(out, node);
                Ok(())
            }
            T::TOpenBracket => self.parse_tuple_type::<S>(out),
            T::TOpenParen if S::BUILDS => {
                let node = self.build_type_script_paren_or_fn_type()?;
                S::b_node(out, node);
                Ok(())
            }
            // "(number | string)" and "(a: number) => string"
            T::TOpenParen => self.skip_type_script_paren_or_fn_type::<S>(out),
            T::TImport if S::BUILDS => {
                let node = self.build_type_script_import_type()?;
                S::b_node(out, node);
                Ok(())
            }
            T::TImport => self.parse_import_type::<S>(opts, out),
            T::TTemplateHead => self.parse_template_type::<S>(out),
            _ => self.parse_type_reference::<S>(kind, opts, out),
        }
    }

    /// `parseLiteralTypeNode`
    #[inline]
    fn parse_literal_type_node<S: TypeSink>(
        &mut self,
        literal: TypeLiteral,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        if S::BUILDS {
            S::b_token(&mut self.lexer, out)?;
        }
        self.lexer.next()?;
        S::literal(out, literal);
        Ok(())
    }

    /// `parseKeywordTypeNode`. A "." after the keyword is read by `parse_postfix_type_rest`.
    fn parse_keyword_type_node<S: TypeSink>(
        &mut self,
        keyword: TypeKeyword,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        if S::BUILDS {
            S::b_token(&mut self.lexer, out)?;
        }
        self.lexer.next()?;
        S::keyword(out, keyword);
        let _ = self.parse_type_predicate_after_name::<S>(out)?;
        Ok(())
    }

    /// "is T" after the first name of a type. Only a lint parse wants a return type around it.
    fn parse_type_predicate_after_name<S: TypeSink>(
        &mut self,
        out: &mut S::Out,
    ) -> Result<bool, Error> {
        if !self.lexer.is_contextual_keyword(b"is") || self.lexer.has_newline_before {
            return Ok(false);
        }
        self.lexer.next()?;
        let mut type_node = <S::Sub as TypeSink>::NONE;
        self.parse_type::<S::Sub>(SkipTypeOptionsBitset::empty(), &mut type_node)?;
        if S::BUILDS {
            S::b_predicate(&mut self.lexer, out, ConstDefault::DEFAULT, type_node)?;
        }
        Ok(true)
    }

    /// `parseTypeArgumentsOfTypeReference`
    fn parse_type_arguments_of_type_reference<S: TypeSink>(
        &mut self,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        // "let foo: any \n <number>foo" must not become a single type
        if !self.lexer.has_newline_before {
            let (_, arguments) =
                self.skip_type_script_type_arguments_in::<S::Sub, false, false>()?;
            if S::BUILDS {
                S::b_type_arguments(&mut self.lexer, out, arguments)?;
            }
        }
        Ok(())
    }

    /// `parseAssertsTypePredicate` in a return type, as before. Elsewhere "asserts" is a name.
    fn parse_asserts_type_predicate<S: TypeSink>(
        &mut self,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        let mut asserts: KK<S, Option<ts::Token>> = ConstDefault::DEFAULT;
        if S::BUILDS {
            S::b_reference(&self.lexer, out);
            asserts = S::b_tok(&self.lexer, ts::TokenKind::Asserts);
        }
        self.lexer.next()?;

        // "function assert(x: boolean): asserts x" and "asserts x is boolean"
        if opts.contains(SkipTypeOptions::IsReturnType)
            && !self.lexer.has_newline_before
            && matches!(self.lexer.token, T::TIdentifier | T::TThis)
        {
            if S::BUILDS {
                if self.lexer.token == T::TThis {
                    S::b_token(&mut self.lexer, out)?;
                } else {
                    S::b_reference(&self.lexer, out);
                }
                let subject_only = <S::Sub as TypeSink>::NONE;
                S::b_predicate(&mut self.lexer, out, asserts, subject_only)?;
            }
            self.lexer.next()?;

            // "asserts x is boolean", where "is" may stand on the next line
            if S::BUILDS && self.lexer.is_contextual_keyword(b"is") {
                self.lexer.next()?;
                let mut type_node = <S::Sub as TypeSink>::NONE;
                self.parse_type::<S::Sub>(SkipTypeOptionsBitset::empty(), &mut type_node)?;
                S::b_predicate(&mut self.lexer, out, ConstDefault::DEFAULT, type_node)?;
                return Ok(());
            }

            // "asserts x \n is boolean"
            if self.lexer.has_newline_before
                && self.lexer.is_contextual_keyword(b"is")
                && self.skip_type_script_predicate_type_after_newline()?
            {
                return Ok(());
            }
        }

        if !self.parse_type_predicate_after_name::<S>(out)? {
            self.parse_type_arguments_of_type_reference::<S>(out)?;
        }
        Ok(())
    }

    /// `parseTypeReference`. `kind` is the kind of the identifier that the lexer is on.
    fn parse_type_reference<S: TypeSink>(
        &mut self,
        kind: TsIdentKind,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        if self.lexer.token == T::TIdentifier {
            if kind == TsIdentKind::Normal {
                S::reference(out, self.lexer.identifier, |name| {
                    self.find_symbol(bun_ast::Loc::EMPTY, name)
                        .map(|found| found.r#ref)
                })?;
            }
            if S::BUILDS {
                S::b_reference(&self.lexer, out);
            }
            self.lexer.next()?;

            // "function assert(x: any): x is boolean"
            if self.parse_type_predicate_after_name::<S>(out)? {
                return Ok(());
            }
        } else if self.lexer.token == T::TConst {
            // "const" takes no type arguments, as before: "x as const < y" is a comparison.
            let r = self.lexer.range();
            if S::BUILDS {
                S::b_reference(&self.lexer, out);
            }
            self.lexer.next()?;

            // "[const: number]"
            if opts.contains(SkipTypeOptions::AllowTupleLabels) && self.lexer.token == T::TColon {
                self.log()
                    .add_range_error(Some(self.source), r, b"Unexpected \"const\"");
            }
            return Ok(());
        } else if self.lexer.is_identifier_or_keyword()
            && (S::STRICT || !self.is_keyword_of_enclosing_type(opts))
        {
            // parseEntityNameOfTypeReference takes a reserved word as the first name
            if S::BUILDS {
                S::b_reference(&self.lexer, out);
            }
            self.lexer.next()?;
        } else {
            // A type is missing. A parse without lint goes on where ".", "[" or an operator follows.
            self.lexer.unexpected()?;
            if S::STRICT {
                return Err(Error::SyntaxError);
            }
            return Ok(());
        }

        self.parse_entity_name_rest::<S>(out)?;
        self.parse_type_arguments_of_type_reference::<S>(out)
    }

    /// Whether "extends" or "in" follows a missing type, as before, rather than names a type.
    fn is_keyword_of_enclosing_type(&mut self, opts: SkipTypeOptionsBitset) -> bool {
        match self.lexer.token {
            T::TExtends => {
                !self.lexer.has_newline_before && self.look_ahead(Self::next_is_start_of_type)
            }
            T::TIn => opts.contains(SkipTypeOptions::IsIndexSignature),
            _ => false,
        }
    }

    /// The loop of `parseEntityName`: the names after the first one.
    fn parse_entity_name_rest<S: TypeSink>(&mut self, out: &mut S::Out) -> Result<(), Error> {
        while self.lexer.token == T::TDot {
            self.lexer.next()?;
            // "A.<B>": the type arguments of a JSDoc-style generic follow
            if self.lexer.token == T::TLessThan {
                break;
            }
            self.parse_right_side_of_dot::<S>(out)?;
        }
        Ok(())
    }

    /// `parseRightSideOfDot` for the name of a type, after the ".".
    fn parse_right_side_of_dot<S: TypeSink>(&mut self, out: &mut S::Out) -> Result<(), Error> {
        if !self.lexer.is_identifier_or_keyword() {
            self.lexer.expect(T::TIdentifier)?;
        }

        let is_name = self.lexer.is_identifier_or_keyword();
        S::member(out, self.lexer.identifier, is_name, |name| {
            self.find_symbol(bun_ast::Loc::EMPTY, name)
                .map(|found| found.r#ref)
        })?;
        if S::BUILDS {
            S::b_member(&mut self.lexer, out)?;
        }

        self.lexer.next()?;
        Ok(())
    }

    /// Whether "import", "new" or "typeof" was the label of a tuple element, as before.
    #[inline]
    fn is_tuple_label(&self, opts: SkipTypeOptionsBitset) -> bool {
        opts.contains(SkipTypeOptions::AllowTupleLabels)
            && matches!(self.lexer.token, T::TColon | T::TQuestion)
    }

    /// `parseImportType`, after "typeof". A string and an object type are its arguments, as before.
    fn parse_import_type<S: TypeSink>(
        &mut self,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        self.lexer.next()?;

        // "[import: number]" and "[import?: number]"
        if self.is_tuple_label(opts) {
            return Ok(());
        }

        self.lexer.expect(T::TOpenParen)?;
        self.lexer.expect(T::TStringLiteral)?;

        // "import('./foo.json', { with: { type: 'json' } })"
        if self.lexer.token == T::TComma {
            self.lexer.next()?;
            self.skip_type_script_object_type()?;

            // "import('./foo.json', { with: { type: 'json' } }, )"
            if self.lexer.token == T::TComma {
                self.lexer.next()?;
            }
        }

        self.lexer.expect(T::TCloseParen)?;

        // "import('fs').promises.FileHandle"
        if self.lexer.token == T::TDot {
            self.lexer.next()?;
            self.parse_right_side_of_dot::<S>(out)?;
            self.parse_entity_name_rest::<S>(out)?;
        }

        // "import('fs')<T>"
        self.parse_type_arguments_of_type_reference::<S>(out)
    }

    /// `parseTypeQuery`
    fn parse_type_query<S: TypeSink>(
        &mut self,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        // "typeof import('fs')"
        if S::BUILDS && self.build_next_token_is(T::TImport) {
            let node = self.build_type_script_import_type()?;
            S::b_node(out, node);
            return Ok(());
        }
        let mut start: KK<S, u32> = ConstDefault::DEFAULT;
        if S::BUILDS {
            start = S::b_start(&self.lexer);
        }
        self.lexer.next()?;

        // "[typeof: number]" and "[typeof?: number]"
        if self.is_tuple_label(opts) {
            return Ok(());
        }

        S::typeof_query(out);

        // "typeof import('fs')"
        if self.lexer.token == T::TImport {
            return self.parse_import_type::<S>(opts, out);
        }

        // "typeof x"
        if !self.lexer.is_identifier_or_keyword() {
            self.lexer.expected(T::TIdentifier)?;
        }
        if S::BUILDS {
            S::b_reference(&self.lexer, out);
        }
        self.lexer.next()?;

        // "typeof x.y" and "typeof x.#y"
        while self.lexer.token == T::TDot {
            self.lexer.next()?;

            if !self.lexer.is_identifier_or_keyword() && self.lexer.token != T::TPrivateIdentifier {
                self.lexer.expected(T::TIdentifier)?;
            }
            if S::BUILDS {
                S::b_member(&mut self.lexer, out)?;
            }
            self.lexer.next()?;
        }

        self.parse_type_arguments_of_type_reference::<S>(out)?;
        if S::BUILDS {
            S::b_query(&self.lexer, out, &start);
        }
        Ok(())
    }

    /// `parseTupleType`
    fn parse_tuple_type<S: TypeSink>(&mut self, out: &mut S::Out) -> Result<(), Error> {
        self.lexer.next()?;

        S::tuple_type(out);

        while self.lexer.token != T::TCloseBracket {
            self.parse_tuple_element_name_or_tuple_element_type()?;
            if self.lexer.token != T::TComma {
                break;
            }
            self.lexer.next()?;
        }
        self.lexer.expect(T::TCloseBracket)?;
        Ok(())
    }

    /// `parseTupleElementNameOrTupleElementType`
    fn parse_tuple_element_name_or_tuple_element_type(&mut self) -> Result<(), Error> {
        // isListElement: an element starts at "," or where a type starts
        let is_reserved_word = self.lexer.token.is_reserved_word() && !self.is_start_of_type(false);
        if is_reserved_word && self.lexer.token != T::TConst {
            return self.parse_tuple_element_at_reserved_word();
        }

        // "[first: number, second?: string, ...rest: boolean[]]"
        if !is_reserved_word
            && (self.lexer.token == T::TDotDotDot || self.lexer.is_identifier_or_keyword())
            && self.look_ahead(Self::scan_start_of_named_tuple_element)
        {
            if self.lexer.token == T::TDotDotDot {
                self.lexer.next()?;
            }
            self.lexer.next()?;
            if self.lexer.token == T::TQuestion {
                self.lexer.next()?;
            }
            self.lexer.expect(T::TColon)?;
            return self.parse_tuple_element_type(SkipTypeOptionsBitset::empty());
        }

        self.parse_tuple_element_type(SkipTypeOptionsBitset::only(
            SkipTypeOptions::AllowTupleLabels,
        ))?;

        // ": type" is read after every type, as before.
        if self.lexer.token == T::TColon {
            self.lexer.next()?;
            self.parse_type::<Discard>(SkipTypeOptionsBitset::empty(), &mut ())?;
        }
        Ok(())
    }

    /// A reserved word that starts no type is reported and read as a label, as before.
    #[cold]
    fn parse_tuple_element_at_reserved_word(&mut self) -> Result<(), Error> {
        self.lexer.unexpected()?;
        self.lexer.next()?;

        if self.lexer.token != T::TColon && self.lexer.token != T::TQuestion {
            self.lexer.expect(T::TColon)?;
        }
        if self.lexer.token == T::TQuestion {
            self.lexer.next()?;
        }
        if self.lexer.token == T::TColon {
            self.lexer.next()?;
            self.parse_type::<Discard>(SkipTypeOptionsBitset::empty(), &mut ())?;
        }
        Ok(())
    }

    /// `scanStartOfNamedTupleElement`
    fn scan_start_of_named_tuple_element(&mut self) -> Result<bool, Error> {
        if self.lexer.token == T::TDotDotDot {
            self.lexer.next()?;
        }
        if !self.lexer.is_identifier_or_keyword() {
            return Ok(false);
        }
        self.next_token_is_colon_or_question_colon()
    }

    /// `nextTokenIsColonOrQuestionColon`
    fn next_token_is_colon_or_question_colon(&mut self) -> Result<bool, Error> {
        self.lexer.next()?;
        if self.lexer.token == T::TColon {
            return Ok(true);
        }
        if self.lexer.token != T::TQuestion {
            return Ok(false);
        }
        self.lexer.next()?;
        Ok(self.lexer.token == T::TColon)
    }

    /// `parseTupleElementType`. The "?" of an optional element is a postfix of the type upstream.
    fn parse_tuple_element_type(&mut self, opts: SkipTypeOptionsBitset) -> Result<(), Error> {
        if self.lexer.token == T::TDotDotDot {
            self.lexer.next()?;
        }
        self.parse_type::<Discard>(opts, &mut ())?;
        if self.lexer.token == T::TQuestion {
            self.lexer.next()?;
        }
        Ok(())
    }

    /// `parseTemplateType`
    fn parse_template_type<S: TypeSink>(&mut self, out: &mut S::Out) -> Result<(), Error> {
        // "`${'a' | 'b'}-${'c' | 'd'}`"
        let mut head: KK<S, Option<ts::TemplatePiece>> = ConstDefault::DEFAULT;
        let mut spans: KK<S, b::List<ts::TemplateLiteralTypeSpan>> = ConstDefault::DEFAULT;
        if S::BUILDS {
            head = S::b_template_piece(&mut self.lexer)?;
        }
        loop {
            self.lexer.next()?;
            let mut type_node = <S::Sub as TypeSink>::NONE;
            self.parse_type::<S::Sub>(SkipTypeOptionsBitset::empty(), &mut type_node)?;
            self.lexer.rescan_close_brace_as_template_token()?;
            if S::BUILDS {
                let literal = S::b_template_piece(&mut self.lexer)?;
                S::b_template_span(&mut spans, type_node, literal);
            }

            if self.lexer.token == T::TTemplateTail {
                self.lexer.next()?;
                break;
            }
        }
        if S::BUILDS {
            S::b_template(&self.lexer, out, head, spans);
        }
        S::template_literal_type(out);
        Ok(())
    }

    /// `isStartOfFunctionTypeOrConstructorType`. "(" is left to `skip_type_script_paren_or_fn_type`.
    fn is_start_of_function_type_or_constructor_type(&mut self) -> bool {
        match self.lexer.token {
            T::TLessThan | T::TNew => true,
            T::TIdentifier => {
                self.lexer.is_contextual_keyword(b"abstract")
                    && self.look_ahead(Self::next_token_is_new_keyword)
            }
            _ => false,
        }
    }

    /// `parseFunctionOrConstructorType`. `new (A)` and `<T>(A)` hold a parenthesized type, as before.
    fn parse_function_or_constructor_type<S: TypeSink>(
        &mut self,
        opts: SkipTypeOptionsBitset,
        out: &mut S::Out,
    ) -> Result<(), Error> {
        if S::BUILDS {
            let node = self.build_type_script_fn_type()?;
            S::b_node(out, node);
        } else {
            // "abstract new () => Foo": parseModifiersForConstructorType
            if self.lexer.token == T::TIdentifier {
                self.lexer.next()?;
            }
            if self.lexer.token == T::TNew {
                self.lexer.next()?;

                // "[new: number]" and "[new?: number]"
                if self.is_tuple_label(opts) {
                    return Ok(());
                }
            }

            // "<T>() => Foo<T>"
            let _ =
                self.skip_type_script_type_parameters(TypeParameterFlag::ALLOW_CONST_MODIFIER)?;
            self.skip_type_script_paren_or_fn_type::<S>(out)?;
        }

        // "[]" and the like are read after a parenthesized type.
        self.parse_postfix_type_rest::<S>(out)
    }

    /// `nextTokenIsNewKeyword`
    fn next_token_is_new_keyword(&mut self) -> Result<bool, Error> {
        self.lexer.next()?;
        Ok(self.lexer.token == T::TNew)
    }

    /// `lookAhead`: what `callback` finds from here on. The lexer is put back.
    fn look_ahead(&mut self, callback: impl FnOnce(&mut Self) -> Result<bool, Error>) -> bool {
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let result = callback(self).unwrap_or(false);
        self.lexer.restore(&old_lexer);
        result
    }

    /// `isStartOfType`
    fn is_start_of_type(&mut self, in_start_of_parameter: bool) -> bool {
        match self.lexer.token {
            T::TIdentifier
            | T::TVoid
            | T::TNull
            | T::TThis
            | T::TTypeof
            | T::TOpenBrace
            | T::TOpenBracket
            | T::TLessThan
            | T::TBar
            | T::TAmpersand
            | T::TNew
            | T::TStringLiteral
            | T::TNumericLiteral
            | T::TBigIntegerLiteral
            | T::TTrue
            | T::TFalse
            | T::TAsterisk
            | T::TQuestion
            | T::TExclamation
            | T::TDotDotDot
            | T::TImport
            | T::TNoSubstitutionTemplateLiteral
            | T::TTemplateHead => true,
            T::TFunction => !in_start_of_parameter,
            T::TMinus => {
                !in_start_of_parameter
                    && self.look_ahead(Self::next_token_is_numeric_or_big_int_literal)
            }
            // "(" starts a type before ")", "...", a name, a modifier or a type, but not in "(1)"
            T::TOpenParen => {
                !in_start_of_parameter
                    && self.stack_check.is_safe_to_recurse()
                    && self.look_ahead(Self::next_is_parenthesized_or_function_type)
            }
            _ => false,
        }
    }

    /// `nextIsStartOfType`
    fn next_is_start_of_type(&mut self) -> Result<bool, Error> {
        self.lexer.next()?;
        Ok(self.is_start_of_type(false))
    }

    /// `nextTokenIsNumericOrBigIntLiteral`
    fn next_token_is_numeric_or_big_int_literal(&mut self) -> Result<bool, Error> {
        self.lexer.next()?;
        Ok(matches!(
            self.lexer.token,
            T::TNumericLiteral | T::TBigIntegerLiteral
        ))
    }

    /// `nextIsParenthesizedOrFunctionType`
    fn next_is_parenthesized_or_function_type(&mut self) -> Result<bool, Error> {
        self.lexer.next()?;
        Ok(self.lexer.token == T::TCloseParen
            || self.is_start_of_parameter()
            || self.is_start_of_type(false))
    }

    /// `isStartOfParameter`
    fn is_start_of_parameter(&mut self) -> bool {
        matches!(
            self.lexer.token,
            T::TDotDotDot
                | T::TOpenBrace
                | T::TOpenBracket
                | T::TPrivateIdentifier
                | T::TIdentifier
                | T::TAt
        ) || self.is_modifier_kind()
            || self.is_start_of_type(true)
    }

    /// An object type at "{": parseMappedType or parseTypeLiteral.
    pub(crate) fn skip_type_script_object_type(&mut self) -> Result<(), Error> {
        self.mark_type_script_only();

        self.lexer.expect(T::TOpenBrace)?;
        if self.next_is_start_of_mapped_type() {
            return self.parse_mapped_type();
        }
        self.parse_type_literal()
    }

    /// nextIsStartOfMappedType, after "{". All of `[K in` must follow, so that every other start stays a member.
    fn next_is_start_of_mapped_type(&mut self) -> bool {
        match self.lexer.token {
            T::TOpenBracket | T::TPlus | T::TMinus => {}
            T::TIdentifier if self.lexer.raw() == b"readonly" => {}
            _ => return false,
        }
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let is_mapped_type = self.scan_start_of_mapped_type().unwrap_or(false);
        self.lexer.restore(&old_lexer);
        is_mapped_type
    }

    fn scan_start_of_mapped_type(&mut self) -> Result<bool, Error> {
        if self.lexer.token == T::TPlus || self.lexer.token == T::TMinus {
            self.lexer.next()?;
            if !self.lexer.is_contextual_keyword(b"readonly") {
                return Ok(false);
            }
        }
        if self.lexer.is_contextual_keyword(b"readonly") {
            self.lexer.next()?;
        }
        if self.lexer.token != T::TOpenBracket {
            return Ok(false);
        }
        self.lexer.next()?;
        if self.lexer.token != T::TIdentifier {
            return Ok(false);
        }
        self.lexer.next()?;
        Ok(self.lexer.token == T::TIn)
    }

    /// parseMappedType, after "{" and where `next_is_start_of_mapped_type` holds.
    fn parse_mapped_type(&mut self) -> Result<(), Error> {
        // "readonly", "+readonly" or "-readonly"
        if self.lexer.token == T::TPlus || self.lexer.token == T::TMinus {
            self.lexer.next()?;
        }
        if self.lexer.is_contextual_keyword(b"readonly") {
            self.lexer.next()?;
        }
        self.lexer.expect(T::TOpenBracket)?;
        self.parse_mapped_type_parameter()?;
        if self.lexer.is_contextual_keyword(b"as") {
            self.lexer.next()?;
            self.skip_type_script_type(Level::Lowest)?;
        }
        self.lexer.expect(T::TCloseBracket)?;
        // "+?" or "-?": the "?", the type annotation and the separator are read as for a property
        if self.lexer.token == T::TPlus || self.lexer.token == T::TMinus {
            self.lexer.next()?;
        }
        self.parse_property_or_method_signature(MemberName::Index, false)?;
        self.parse_type_member_list()
    }

    /// parseMappedTypeParameter
    fn parse_mapped_type_parameter(&mut self) -> Result<(), Error> {
        self.lexer.expect(T::TIdentifier)?;
        self.lexer.expect(T::TIn)?;
        self.skip_type_script_type(Level::Lowest)
    }

    /// parseTypeLiteral, after "{".
    fn parse_type_literal(&mut self) -> Result<(), Error> {
        self.parse_type_member_list()
    }

    /// parseObjectTypeMembers
    fn parse_object_type_members(&mut self) -> Result<(), Error> {
        self.lexer.expect(T::TOpenBrace)?;
        self.parse_type_member_list()
    }

    /// The members up to "}", and the "}".
    fn parse_type_member_list(&mut self) -> Result<(), Error> {
        while self.lexer.token != T::TCloseBrace {
            self.parse_type_member()?;
        }
        self.lexer.expect(T::TCloseBrace)?;
        Ok(())
    }

    /// parseTypeMember
    fn parse_type_member(&mut self) -> Result<(), Error> {
        // "+" or "-" is accepted before any member, not only before "readonly" of a mapped type
        if self.lexer.token == T::TPlus || self.lexer.token == T::TMinus {
            self.lexer.next()?;
        }

        match self.lexer.token {
            T::TOpenParen | T::TLessThan => return self.parse_signature_member(false),
            T::TNew => {
                self.lexer.next()?;
                if self.lexer.token == T::TOpenParen || self.lexer.token == T::TLessThan {
                    return self.parse_signature_member(true);
                }
                return self.parse_property_or_method_signature(MemberName::Word, false);
            }
            _ => {}
        }

        match self.parse_modifiers_of_type_member()? {
            AfterModifiers::Name => {
                self.parse_property_or_method_signature(MemberName::Word, false)
            }
            AfterModifiers::Accessor => self.parse_accessor_declaration(),
            AfterModifiers::Member => {
                if self.lexer.token == T::TOpenBracket {
                    // isIndexSignature and parseIndexSignatureDeclaration, or a computed name
                    return match self.parse_bracketed_name(true)? {
                        Bracketed::Type => {
                            self.parse_property_or_method_signature(MemberName::Bracket, false)
                        }
                        Bracketed::TypeWithIndex => {
                            self.parse_property_or_method_signature(MemberName::Index, false)
                        }
                        Bracketed::Expression => {
                            self.parse_property_or_method_signature_of_reference(true, false)
                        }
                        Bracketed::Parameters => self.parse_type_of_index_signature(),
                    };
                }
                if self.is_property_name_of_one_loop() {
                    self.lexer.next()?;
                    return self.parse_property_or_method_signature(MemberName::Word, false);
                }
                // A private name. A bigint too, but not inside an attempt, so that `f<{ 1n: a }>(b)` stays a comparison.
                if self.lexer.token == T::TPrivateIdentifier
                    || (self.lexer.token == T::TBigIntegerLiteral && !self.lexer.is_log_disabled)
                {
                    self.lexer.next()?;
                    return self.parse_property_or_method_signature_of_reference(false, false);
                }
                self.parse_property_or_method_signature(MemberName::None, false)
            }
        }
    }

    /// parseModifiers for a member, and the test for "get" and "set" that parseTypeMember makes after it.
    fn parse_modifiers_of_type_member(&mut self) -> Result<AfterModifiers, Error> {
        let mut has_static = false;
        loop {
            // nextTokenCanFollowModifier: the word is read first, then the token after it decides
            let can_follow = match self.lexer.token {
                T::TIdentifier => {
                    let Some(keyword) = MEMBER_KEYWORD_MAP.get(self.lexer.raw()).copied() else {
                        return Ok(AfterModifiers::Member);
                    };
                    self.lexer.next()?;
                    match keyword {
                        MemberKeyword::Accessor => {
                            // canFollowGetOrSetKeyword
                            if self.lexer.token == T::TOpenBracket
                                || self.is_literal_property_name()
                            {
                                return Ok(AfterModifiers::Accessor);
                            }
                            return Ok(AfterModifiers::Name);
                        }
                        MemberKeyword::Static => {
                            let is_first = !has_static;
                            has_static = true;
                            is_first && self.can_follow_modifier()
                        }
                        MemberKeyword::Modifier => {
                            !self.lexer.has_newline_before && self.can_follow_modifier()
                        }
                    }
                }
                T::TIn => {
                    self.lexer.next()?;
                    !self.lexer.has_newline_before && self.can_follow_modifier()
                }
                T::TConst => {
                    self.lexer.next()?;
                    self.lexer.token == T::TEnum
                }
                T::TDefault => {
                    self.lexer.next()?;
                    self.can_follow_default_keyword()
                }
                T::TExport => {
                    self.lexer.next()?;
                    self.can_follow_export_keyword()
                }
                _ => return Ok(AfterModifiers::Member),
            };
            if !can_follow {
                return Ok(AfterModifiers::Name);
            }
        }
    }

    /// IsModifierKind for the token the lexer is on.
    fn is_modifier_kind(&self) -> bool {
        match self.lexer.token {
            T::TConst | T::TDefault | T::TExport | T::TIn => true,
            T::TIdentifier => matches!(
                MEMBER_KEYWORD_MAP.get(self.lexer.raw()).copied(),
                Some(MemberKeyword::Modifier | MemberKeyword::Static)
            ),
            _ => false,
        }
    }

    /// canFollowModifier
    fn can_follow_modifier(&self) -> bool {
        matches!(
            self.lexer.token,
            T::TOpenBracket | T::TOpenBrace | T::TAsterisk | T::TDotDotDot
        ) || self.is_literal_property_name()
    }

    /// isLiteralPropertyName. A private name counts, as it does in the reference.
    fn is_literal_property_name(&self) -> bool {
        self.lexer.is_identifier_or_keyword()
            || matches!(
                self.lexer.token,
                T::TPrivateIdentifier
                    | T::TStringLiteral
                    | T::TNumericLiteral
                    | T::TBigIntegerLiteral
            )
    }

    /// Whether the lexer is on a word, a string or a number: the names that may follow each other without a separator.
    fn is_property_name_of_one_loop(&self) -> bool {
        self.lexer.is_identifier_or_keyword()
            || self.lexer.token == T::TStringLiteral
            || self.lexer.token == T::TNumericLiteral
    }

    /// nextTokenCanFollowDefaultKeyword, after "default".
    fn can_follow_default_keyword(&mut self) -> bool {
        match self.lexer.token {
            T::TClass | T::TFunction | T::TAt => true,
            T::TIdentifier => {
                let word = self.lexer.raw();
                if word == b"abstract" {
                    return self.next_token_is_on_same_line(T::TClass);
                }
                if word == b"async" {
                    return self.next_token_is_on_same_line(T::TFunction);
                }
                word == b"interface"
            }
            _ => false,
        }
    }

    /// nextTokenCanFollowModifier for "export", after "export".
    fn can_follow_export_keyword(&mut self) -> bool {
        let is_default = self.lexer.token == T::TDefault;
        if !is_default && !self.lexer.is_contextual_keyword(b"type") {
            return self.can_follow_export_modifier();
        }
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let can_follow = self.lexer.next().is_ok()
            && if is_default {
                self.can_follow_default_keyword()
            } else {
                self.can_follow_export_modifier()
            };
        self.lexer.restore(&old_lexer);
        can_follow
    }

    /// canFollowExportModifier
    fn can_follow_export_modifier(&self) -> bool {
        self.lexer.token == T::TAt
            || (self.lexer.token != T::TAsterisk
                && self.lexer.token != T::TOpenBrace
                && !self.lexer.is_contextual_keyword(b"as")
                && self.can_follow_modifier())
    }

    /// Whether `token` is the token after the current one, on the same line.
    fn next_token_is_on_same_line(&mut self, token: T) -> bool {
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let is_next = self.lexer.next().is_ok()
            && self.lexer.token == token
            && !self.lexer.has_newline_before;
        self.lexer.restore(&old_lexer);
        is_next
    }

    /// parseSignatureMember. "new" of a construct signature was read.
    fn parse_signature_member(&mut self, is_construct: bool) -> Result<(), Error> {
        let name = if is_construct {
            MemberName::Word
        } else {
            MemberName::None
        };
        self.parse_property_or_method_signature(name, false)
    }

    /// parseAccessorDeclaration, after "get" or "set" and on the name.
    fn parse_accessor_declaration(&mut self) -> Result<(), Error> {
        if self.lexer.token == T::TOpenBracket {
            return match self.parse_bracketed_name(false)? {
                Bracketed::Type => {
                    self.parse_property_or_method_signature(MemberName::Bracket, true)
                }
                Bracketed::TypeWithIndex => {
                    self.parse_property_or_method_signature(MemberName::Index, true)
                }
                Bracketed::Expression | Bracketed::Parameters => {
                    self.parse_property_or_method_signature_of_reference(true, true)
                }
            };
        }
        let is_name_of_one_loop = self.is_property_name_of_one_loop();
        self.lexer.next()?;
        if is_name_of_one_loop {
            self.parse_property_or_method_signature(MemberName::Word, true)
        } else {
            self.parse_property_or_method_signature_of_reference(false, true)
        }
    }

    /// parsePropertyOrMethodSignature after a name that only the reference reads, or parseAccessorDeclaration after such a name.
    fn parse_property_or_method_signature_of_reference(
        &mut self,
        is_computed_name: bool,
        is_accessor: bool,
    ) -> Result<(), Error> {
        let has_question = !is_accessor && self.lexer.token == T::TQuestion;
        if has_question {
            self.lexer.next()?;
        }
        if is_accessor || self.lexer.token == T::TOpenParen || self.lexer.token == T::TLessThan {
            // parseTypeParameters, parseParameters and parseReturnType
            let _ =
                self.skip_type_script_type_parameters(TypeParameterFlag::ALLOW_CONST_MODIFIER)?;
            self.skip_typescript_fn_args()?;
            if self.lexer.token == T::TColon {
                self.lexer.next()?;
                self.skip_typescript_return_type()?;
            }
            // parseFunctionBlockOrSemicolon
            if is_accessor
                && self.lexer.token == T::TOpenBrace
                && self.parse_function_block_in_type()?
            {
                return Ok(());
            }
        } else {
            // parseTypeAnnotation and parseInitializer
            let has_type_annotation = self.lexer.token == T::TColon;
            if has_type_annotation {
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
            }
            // scanTypeMemberStart: "#a = 1" starts no member, "#a? = 1" and "[a + b] = 1" start one
            if (has_type_annotation || has_question || is_computed_name)
                && self.lexer.token == T::TEquals
            {
                self.parse_initializer_in_type()?;
            }
        }
        self.parse_type_member_semicolon()
    }

    /// The type annotation and the separator of parseIndexSignatureDeclaration.
    fn parse_type_of_index_signature(&mut self) -> Result<(), Error> {
        if self.lexer.token == T::TColon {
            self.lexer.next()?;
            self.skip_type_script_type(Level::Lowest)?;
        }
        self.parse_type_member_semicolon()
    }

    /// parsePropertyOrMethodSignature after the name, and the signature of parseSignatureMember and parseAccessorDeclaration.
    fn parse_property_or_method_signature(
        &mut self,
        name: MemberName,
        is_accessor: bool,
    ) -> Result<(), Error> {
        // Whether the member is one that the reference reads too: only then may a block or an initializer follow.
        let mut is_reference_form = name == MemberName::Word || name == MemberName::Bracket;
        let mut has_question = false;
        if name != MemberName::None {
            // "a b: c": a name that a name or "[" follows is a member of its own, with or without a separator
            if name == MemberName::Word
                && (self.is_property_name_of_one_loop() || self.lexer.token == T::TOpenBracket)
            {
                return Ok(());
            }
            if self.lexer.token == T::TQuestion {
                // "a?: b". The reference reads no "?" after the name of an accessor
                self.lexer.next()?;
                has_question = true;
                if is_accessor {
                    is_reference_form = false;
                }
            } else if self.lexer.token == T::TExclamation {
                // "a!: b" is accepted
                self.lexer.next()?;
                is_reference_form = false;
            }
        }

        // parseTypeParameters
        let has_type_parameters = self.lexer.token == T::TLessThan;
        let _ = self.skip_type_script_type_parameters(TypeParameterFlag::ALLOW_CONST_MODIFIER)?;
        // The reference reads parameters after type parameters and after the name of an accessor
        let may_have_initializer = is_reference_form && !has_type_parameters && !is_accessor;

        match self.lexer.token {
            T::TOpenParen => {
                // parseParameters and parseReturnType
                self.skip_typescript_fn_args()?;
                if self.lexer.token == T::TColon {
                    self.lexer.next()?;
                    self.skip_typescript_return_type()?;
                }
                // parseFunctionBlockOrSemicolon
                if is_accessor
                    && is_reference_form
                    && self.lexer.token == T::TOpenBrace
                    && self.parse_function_block_in_type()?
                {
                    return Ok(());
                }
            }
            T::TColon => {
                if name == MemberName::None {
                    self.lexer.expect(T::TIdentifier)?;
                }
                // parseTypeAnnotation and parseInitializer
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
                if may_have_initializer && self.lexer.token == T::TEquals {
                    self.parse_initializer_in_type()?;
                }
            }
            _ => {
                if name == MemberName::None {
                    self.lexer.unexpected()?;
                    return Err(Error::SyntaxError);
                }
                // scanTypeMemberStart: "a = 1" starts no member, "a? = 1" and "[a] = 1" start one
                if may_have_initializer
                    && (has_question || name == MemberName::Bracket)
                    && self.lexer.token == T::TEquals
                {
                    self.parse_initializer_in_type()?;
                }
            }
        }

        self.parse_type_member_semicolon()
    }

    /// parseTypeMemberSemicolon
    fn parse_type_member_semicolon(&mut self) -> Result<(), Error> {
        match self.lexer.token {
            T::TCloseBrace => {}
            T::TComma | T::TSemicolon => {
                self.lexer.next()?;
            }
            _ => {
                if !self.lexer.has_newline_before {
                    self.lexer.unexpected()?;
                    return Err(Error::SyntaxError);
                }
            }
        }
        Ok(())
    }

    /// "[" to "]" where a member or the name of an accessor starts: read as a type first, then as the reference reads it.
    fn parse_bracketed_name(&mut self, is_member_start: bool) -> Result<Bracketed, Error> {
        let mark = self.read_mark();
        let result = self.skip_type_script_bracketed_name();
        // Inside an attempt only the first reading counts, so that `f<{ [a + b]: c }>(d)` stays a comparison.
        if self.lexer.is_log_disabled || (result.is_ok() && self.log().errors == mark.errors) {
            return result;
        }
        self.reread_bracketed_name(&mark, is_member_start, result)
    }

    #[cold]
    #[inline(never)]
    fn reread_bracketed_name(
        &mut self,
        mark: &ReadMark<'a>,
        is_member_start: bool,
        result: Result<Bracketed, Error>,
    ) -> Result<Bracketed, Error> {
        if let Err(Error::StackOverflow | Error::Alloc(_)) = result {
            return result;
        }
        let failed = self.set_aside_failed_read(mark);
        let reread = if is_member_start && self.is_index_signature() {
            self.parse_index_signature_declaration()
                .map(|()| Bracketed::Parameters)
        } else {
            self.parse_computed_property_name()
                .map(|()| Bracketed::Expression)
        };
        match reread {
            Ok(bracketed) if self.log().errors == mark.errors => Ok(bracketed),
            Err(err @ (Error::StackOverflow | Error::Alloc(_))) => Err(err),
            _ => {
                // Neither reading fits: the errors stay the ones of the first.
                self.restore_failed_read(mark, failed);
                result
            }
        }
    }

    /// "[" type "]" with ": type" or "in type as type" before the "]" and a sign after it: an index signature, the head of a mapped type or a name, not told apart.
    fn skip_type_script_bracketed_name(&mut self) -> Result<Bracketed, Error> {
        self.lexer.next()?;
        self.skip_type_script_type_with_opts::<Discard>(
            Level::Lowest,
            SkipTypeOptionsBitset::only(SkipTypeOptions::IsIndexSignature),
            &mut (),
        )?;

        let mut bracketed = Bracketed::Type;
        match self.lexer.token {
            // "{ [key: string]: number }"
            T::TColon => {
                bracketed = Bracketed::TypeWithIndex;
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
            }
            // "{ [K in keyof T as `get-${K}`]: T[K] }". Without "as" the reference reads the name `[K in T]` here
            T::TIn => {
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
                if self.lexer.is_contextual_keyword(b"as") {
                    bracketed = Bracketed::TypeWithIndex;
                    self.lexer.next()?;
                    self.skip_type_script_type(Level::Lowest)?;
                }
            }
            _ => {}
        }

        self.lexer.expect(T::TCloseBracket)?;

        // "{ [K in keyof T]+?: T[K] }"
        if self.lexer.token == T::TPlus || self.lexer.token == T::TMinus {
            bracketed = Bracketed::TypeWithIndex;
            self.lexer.next()?;
        }
        Ok(bracketed)
    }

    /// isIndexSignature
    fn is_index_signature(&mut self) -> bool {
        if self.lexer.token != T::TOpenBracket {
            return false;
        }
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let is_index_signature = self
            .next_is_unambiguously_index_signature()
            .unwrap_or(false);
        self.lexer.restore(&old_lexer);
        is_index_signature
    }

    /// nextIsUnambiguouslyIndexSignature
    fn next_is_unambiguously_index_signature(&mut self) -> Result<bool, Error> {
        self.lexer.next()?;
        if self.lexer.token == T::TDotDotDot || self.lexer.token == T::TCloseBracket {
            return Ok(true);
        }
        if self.is_modifier_kind() {
            self.lexer.next()?;
            if self.lexer.token == T::TIdentifier {
                return Ok(true);
            }
        } else if self.lexer.token != T::TIdentifier {
            return Ok(false);
        } else {
            self.lexer.next()?;
        }
        // "[id:" is an index signature, and "[id," is one that is not well formed
        if self.lexer.token == T::TColon || self.lexer.token == T::TComma {
            return Ok(true);
        }
        if self.lexer.token != T::TQuestion {
            return Ok(false);
        }
        // After "?" these tokens cannot continue a conditional expression
        self.lexer.next()?;
        Ok(matches!(
            self.lexer.token,
            T::TColon | T::TComma | T::TCloseBracket
        ))
    }

    /// parseIndexSignatureDeclaration up to "]". The caller reads the type annotation and the separator.
    fn parse_index_signature_declaration(&mut self) -> Result<(), Error> {
        self.lexer.expect(T::TOpenBracket)?;
        while self.lexer.token != T::TCloseBracket {
            // parseParameter
            if self.lexer.token == T::TDotDotDot {
                self.lexer.next()?;
            }
            self.skip_type_script_binding()?;
            if self.lexer.token == T::TQuestion {
                self.lexer.next()?;
            }
            if self.lexer.token == T::TColon {
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
            }
            if self.lexer.token == T::TEquals {
                self.lexer.next()?;
                self.parse_and_drop_in_type(Dropped::Initializer)?;
            }
            if self.lexer.token != T::TComma {
                break;
            }
            self.lexer.next()?;
        }
        self.lexer.expect(T::TCloseBracket)?;
        Ok(())
    }

    /// parseComputedPropertyName
    fn parse_computed_property_name(&mut self) -> Result<(), Error> {
        self.lexer.expect(T::TOpenBracket)?;
        self.parse_and_drop_in_type(Dropped::ComputedPropertyName)?;
        self.lexer.expect(T::TCloseBracket)?;
        Ok(())
    }

    /// parseInitializer of a property signature, at "=". Where no expression follows, the "=" is left for the caller to report.
    #[cold]
    #[inline(never)]
    fn parse_initializer_in_type(&mut self) -> Result<(), Error> {
        // Inside an attempt the "=" is left where it is, and the separator that is missing ends the attempt.
        if self.lexer.is_log_disabled {
            return Ok(());
        }
        let at_equals = self.lexer.snapshot();
        self.lexer.next()?;
        match self.parse_and_drop_in_type(Dropped::Initializer) {
            Err(Error::Backtrack) => {
                self.lexer.restore(&at_equals);
                Ok(())
            }
            result => result,
        }
    }

    /// parseFunctionBlockOrSemicolon of an accessor, at "{". False where no block was read: the "{" is left for the caller to report.
    #[cold]
    #[inline(never)]
    fn parse_function_block_in_type(&mut self) -> Result<bool, Error> {
        // Inside an attempt the "{" is left where it is, and the separator that is missing ends the attempt.
        if self.lexer.is_log_disabled {
            return Ok(false);
        }
        match self.parse_and_drop_in_type(Dropped::FunctionBlock) {
            Ok(()) => Ok(true),
            Err(Error::Backtrack) => Ok(false),
            Err(err) => Err(err),
        }
    }

    /// The lexer and the log as they are now.
    #[inline]
    fn read_mark(&self) -> ReadMark<'a> {
        let log = self.log();
        ReadMark {
            lexer: self.lexer.snapshot(),
            msgs_len: log.msgs.len(),
            errors: log.errors,
            warnings: log.warnings,
        }
    }

    /// Drops what was read and what was logged since `mark`.
    #[cold]
    #[inline(never)]
    fn rewind_to_read_mark(&mut self, mark: &ReadMark<'a>) {
        self.lexer.restore(&mark.lexer);
        let log = self.log();
        log.msgs.truncate(mark.msgs_len);
        log.errors = mark.errors;
        log.warnings = mark.warnings;
    }

    /// Sets aside what the reading since `mark` left and goes back to `mark`, for another reading of the same tokens.
    #[cold]
    #[inline(never)]
    fn set_aside_failed_read(&mut self, mark: &ReadMark<'a>) -> FailedRead<'a> {
        let lexer = self.lexer.snapshot();
        let log = self.log();
        let first = mark.msgs_len.min(log.msgs.len());
        let failed = FailedRead {
            lexer,
            msgs: log.msgs.split_off(first),
            errors: log.errors,
            warnings: log.warnings,
        };
        self.rewind_to_read_mark(mark);
        failed
    }

    /// Puts back what `set_aside_failed_read` took, where the other reading failed too. No reading runs twice.
    #[cold]
    #[inline(never)]
    fn restore_failed_read(&mut self, mark: &ReadMark<'a>, failed: FailedRead<'a>) {
        let FailedRead {
            mut lexer,
            msgs,
            errors,
            warnings,
        } = failed;
        self.rewind_to_read_mark(mark);
        let log = self.log();
        log.msgs.extend(msgs);
        log.errors = errors;
        log.warnings = warnings;
        // The comments that the first reading passed are not collected again.
        lexer.all_comments_len = self.lexer.all_comments.len();
        lexer.comments_to_preserve_before_len = self.lexer.comments_to_preserve_before.len();
        self.lexer.restore(&lexer);
    }

    /// Reads an expression or a function block that sits inside a type and keeps the position after it, nothing else.
    #[cold]
    #[inline(never)]
    fn parse_and_drop_in_type(&mut self, what: Dropped) -> Result<(), Error> {
        let errors = self.log().errors;
        let has_import_meta = self.has_import_meta;
        let has_with_scope = self.has_with_scope;
        let has_es_module_syntax = self.has_es_module_syntax;
        let needs_jsx_import = self.needs_jsx_import;
        let top_level_await_keyword = self.top_level_await_keyword;
        // A name in what is dropped is no use of an import.
        let parse_pass_symbol_uses = self.parse_pass_symbol_uses.take();
        let snapshot = self.parser_snapshot();

        // With the log off a missing operand goes unnoticed: the count of errors decides.
        self.lexer.is_log_disabled = false;
        self.allow_in = true;
        // The reference reads "super" and private names anywhere and leaves them to its checker.
        self.allow_private_identifiers = true;
        self.fn_or_arrow_data_parse.allow_super_call = true;
        self.fn_or_arrow_data_parse.allow_super_property = true;
        let result = match what {
            Dropped::ComputedPropertyName => self.parse_expr(Level::Lowest).map(|_| ()),
            Dropped::Initializer => self.parse_expr(Level::Comma).map(|_| ()),
            Dropped::LeftHandSide => self.parse_expr(Level::New).map(|_| ()),
            Dropped::FunctionBlock => self.parse_function_block_of_accessor(),
        };
        let has_failed = result.is_err() || self.log().errors != errors;
        let mut end = self.lexer.snapshot();

        // Scopes, symbols, import records and messages of what was read go away, and the lexer goes back.
        self.restore_parser_snapshot(snapshot);
        self.parse_pass_symbol_uses = parse_pass_symbol_uses;
        self.has_import_meta = has_import_meta;
        self.has_with_scope = has_with_scope;
        self.has_es_module_syntax = has_es_module_syntax;
        self.needs_jsx_import = needs_jsx_import;
        self.top_level_await_keyword = top_level_await_keyword;

        if has_failed {
            return Err(match result {
                Err(err @ (Error::StackOverflow | Error::Alloc(_))) => err,
                _ => Error::Backtrack,
            });
        }

        // Only the position moves: the comments inside what was read are dropped with it.
        end.is_log_disabled = self.lexer.is_log_disabled;
        end.prev_error_loc = self.lexer.prev_error_loc;
        end.all_comments_len = self.lexer.all_comments.len();
        end.comments_to_preserve_before_len = self.lexer.comments_to_preserve_before.len();
        self.lexer.restore(&end);
        Ok(())
    }

    /// parseFunctionBlock of an accessor of a type, at "{".
    fn parse_function_block_of_accessor(&mut self) -> Result<(), Error> {
        // The scope of the parameters must start before the scope of the body.
        let parameters_loc = bun_ast::Loc {
            start: self.lexer.loc().start - 1,
        };
        let _ =
            self.push_scope_for_parse_pass(bun_ast::scope::Kind::FunctionArgs, parameters_loc)?;
        let mut data = FnOrArrowDataParse {
            allow_super_call: true,
            allow_super_property: true,
            ..Default::default()
        };
        self.parse_fn_body(&mut data).map(|_| ())
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
        self.lexer.next()?;

        if self.lexer.token == T::TGreaterThan
            && flags.contains(TypeParameterFlag::ALLOW_EMPTY_TYPE_PARAMETERS)
        {
            self.lexer.next()?;
            return Ok(SkipTypeParameterResult::DefinitelyTypeParameters);
        }

        loop {
            let mut has_in = false;
            let mut has_out = false;
            let mut expect_identifier = true;
            let mut is_named_out = false;

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
                    continue;
                }

                if self.lexer.is_contextual_keyword(b"out") {
                    let r = self.lexer.range();
                    let had_invalid_modifier = invalid_modifier_range.len > 0;
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
                    // "function foo<out>() {}": what follows names no parameter, so "out" does
                    if !flags.contains(TypeParameterFlag::ALLOW_IN_OUT_VARIANCE_ANNOTATIONS)
                        && (self.lexer.has_newline_before || !self.can_follow_modifier())
                    {
                        if !had_invalid_modifier {
                            invalid_modifier_range = bun_ast::Range::NONE;
                        }
                        is_named_out = true;
                        break;
                    }
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
            if !is_named_out && (expect_identifier || self.lexer.token == T::TIdentifier) {
                self.lexer.expect(T::TIdentifier)?;
            }

            // "class Foo<T extends number> {}"
            if self.lexer.token == T::TExtends {
                result = SkipTypeParameterResult::DefinitelyTypeParameters;
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
            }

            // "class Foo<T = void> {}"
            if self.lexer.token == T::TEquals {
                result = SkipTypeParameterResult::DefinitelyTypeParameters;
                self.lexer.next()?;
                self.skip_type_script_type(Level::Lowest)?;
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
        Ok(result)
    }

    pub(crate) fn skip_type_script_type_stmt(
        &mut self,
        opts: &mut ParseStatementOptions,
    ) -> Result<(), Error> {
        if opts.is_export {
            match self.lexer.token {
                T::TOpenBrace => {
                    // "export type {foo}"
                    // "export type {foo} from 'bar'"
                    let clause = self.parse_export_clause()?;
                    let mut path = None;
                    if self.lexer.is_contextual_keyword(b"from") {
                        self.lexer.next()?;
                        path = Some(self.parse_path()?);
                    }
                    self.lexer.expect_or_insert_semicolon()?;
                    if let Some(starts) = &mut self.starts_for_parse_only {
                        starts.erased.hold(crate::parse::erased::ErasedData::export(
                            crate::parse::erased::Cursor::at(&self.lexer),
                            self.arena,
                            crate::parse::erased::ExportClause::Named(
                                bun_ast::StoreSlice::new_mut(clause.clauses),
                            ),
                            path,
                        ));
                    }
                    return Ok(());
                }
                T::TAsterisk => {
                    // https://github.com/microsoft/TypeScript/pull/52217
                    // - export type * as Foo from 'bar';
                    // - export type Foo from 'bar';
                    self.lexer.next()?;
                    let mut clause = crate::parse::erased::ExportClause::Star;
                    if self.lexer.is_contextual_keyword(b"as") {
                        // "export type * as ns from 'path'"
                        self.lexer.next()?;
                        let alias = self.parse_clause_alias(b"export")?;
                        if self.starts_for_parse_only.is_some() {
                            clause = crate::parse::erased::ExportClause::Namespace(
                                crate::parse::erased::Name::here(&self.lexer, alias),
                            );
                        }
                        self.lexer.next()?;
                    }
                    self.lexer.expect_contextual_keyword(b"from")?;
                    let path = self.parse_path()?;
                    self.lexer.expect_or_insert_semicolon()?;
                    if let Some(starts) = &mut self.starts_for_parse_only {
                        starts.erased.hold(crate::parse::erased::ErasedData::export(
                            crate::parse::erased::Cursor::at(&self.lexer),
                            self.arena,
                            clause,
                            Some(path),
                        ));
                    }
                    return Ok(());
                }
                _ => {}
            }
        }

        let name = self.lexer.identifier;
        self.lexer.expect(T::TIdentifier)?;

        if opts.scope.is_module() {
            self.local_type_names.put(name, true)?;
        }

        let _ = self.skip_type_script_type_parameters(
            TypeParameterFlag::ALLOW_IN_OUT_VARIANCE_ANNOTATIONS
                | TypeParameterFlag::ALLOW_EMPTY_TYPE_PARAMETERS,
        )?;

        self.lexer.expect(T::TEquals)?;
        self.skip_type_script_type(Level::Lowest)?;
        self.lexer.expect_or_insert_semicolon()?;
        Ok(())
    }

    /// parseInterfaceDeclaration, after "interface".
    pub(crate) fn skip_type_script_interface_stmt(
        &mut self,
        opts: &mut ParseStatementOptions,
    ) -> Result<(), Error> {
        let name = self.lexer.identifier;
        self.lexer.expect(T::TIdentifier)?;

        if opts.scope.is_module() {
            self.local_type_names.put(name, true)?;
        }

        let _ = self.skip_type_script_type_parameters(
            TypeParameterFlag::ALLOW_IN_OUT_VARIANCE_ANNOTATIONS
                | TypeParameterFlag::ALLOW_EMPTY_TYPE_PARAMETERS,
        )?;

        self.parse_heritage_clauses()?;
        self.parse_object_type_members()
    }

    /// parseHeritageClauses of an interface
    fn parse_heritage_clauses(&mut self) -> Result<(), Error> {
        while self.lexer.token == T::TExtends || self.lexer.is_contextual_keyword(b"implements") {
            self.parse_heritage_clause()?;
        }
        Ok(())
    }

    /// parseHeritageClause, at "extends" or "implements".
    fn parse_heritage_clause(&mut self) -> Result<(), Error> {
        self.lexer.next()?;
        loop {
            // "extends {}" and "extends A, {}": these braces hold the members
            if self.lexer.token == T::TOpenBrace && !self.is_valid_heritage_clause_object_literal()
            {
                break;
            }
            self.parse_type_heritage_clause_element()?;
            if self.lexer.token != T::TComma {
                break;
            }
            self.lexer.next()?;
        }
        Ok(())
    }

    /// isValidHeritageClauseObjectLiteral
    fn is_valid_heritage_clause_object_literal(&mut self) -> bool {
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let is_valid = self
            .next_is_valid_heritage_clause_object_literal()
            .unwrap_or(true);
        self.lexer.restore(&old_lexer);
        is_valid
    }

    /// nextIsValidHeritageClauseObjectLiteral
    fn next_is_valid_heritage_clause_object_literal(&mut self) -> Result<bool, Error> {
        self.lexer.next()?;
        if self.lexer.token != T::TCloseBrace {
            return Ok(true);
        }
        self.lexer.next()?;
        Ok(self.is_end_of_heritage_clause_element())
    }

    /// Whether the lexer is on a token that may follow an entry of an "extends" or "implements" list.
    fn is_end_of_heritage_clause_element(&self) -> bool {
        matches!(self.lexer.token, T::TComma | T::TOpenBrace | T::TExtends)
            || self.lexer.is_contextual_keyword(b"implements")
    }

    /// parseTypeHeritageClauseElement: a type first, then what parseExpressionWithTypeArguments reads.
    fn parse_type_heritage_clause_element(&mut self) -> Result<(), Error> {
        let mark = self.read_mark();
        let result = self.skip_type_script_type(Level::Lowest);
        // Inside an attempt only the first reading counts.
        if self.lexer.is_log_disabled
            || (result.is_ok()
                && self.log().errors == mark.errors
                && self.is_end_of_heritage_clause_element())
        {
            return result;
        }
        self.reread_heritage_clause_element(&mark, result)
    }

    #[cold]
    #[inline(never)]
    fn reread_heritage_clause_element(
        &mut self,
        mark: &ReadMark<'a>,
        result: Result<(), Error>,
    ) -> Result<(), Error> {
        if let Err(Error::StackOverflow | Error::Alloc(_)) = result {
            return result;
        }
        let failed = self.set_aside_failed_read(mark);
        match self.parse_expression_with_type_arguments() {
            Ok(())
                if self.log().errors == mark.errors && self.is_end_of_heritage_clause_element() =>
            {
                Ok(())
            }
            Err(err @ (Error::StackOverflow | Error::Alloc(_))) => Err(err),
            _ => {
                // Neither reading fits: the errors stay the ones of the first.
                self.restore_failed_read(mark, failed);
                result
            }
        }
    }

    /// parseExpressionWithTypeArguments
    fn parse_expression_with_type_arguments(&mut self) -> Result<(), Error> {
        self.parse_and_drop_in_type(Dropped::LeftHandSide)?;
        let _ = self.skip_type_script_type_arguments::<false, false>()?;
        Ok(())
    }

    #[inline]
    pub(crate) fn skip_type_script_type_arguments<
        const IS_INSIDE_JSX_ELEMENT: bool,
        const IS_PARSE_TYPE_ARGUMENTS_IN_EXPRESSION: bool,
    >(
        &mut self,
    ) -> Result<bool, Error> {
        let (has_type_arguments, ()) = self.skip_type_script_type_arguments_in::<
            Discard,
            IS_INSIDE_JSX_ELEMENT,
            IS_PARSE_TYPE_ARGUMENTS_IN_EXPRESSION,
        >()?;
        Ok(has_type_arguments)
    }

    /// Type arguments, if "<" starts them here, and the list that `N` keeps of them.
    pub(crate) fn skip_type_script_type_arguments_in<
        N: TypeSink,
        const IS_INSIDE_JSX_ELEMENT: bool,
        const IS_PARSE_TYPE_ARGUMENTS_IN_EXPRESSION: bool,
    >(
        &mut self,
    ) -> Result<(bool, KK<N, Option<b::Closed>>), Error> {
        self.mark_type_script_only();
        // "x as A <= b": only "<" opens the list, alone or as the first half of "<<"
        match self.lexer.token {
            T::TLessThan | T::TLessThanLessThan => {}
            _ => {
                return Ok((false, ConstDefault::DEFAULT));
            }
        }

        let mut list: KK<N, b::List<ts::Type>> = ConstDefault::DEFAULT;
        let mut arguments: KK<N, Option<b::Closed>> = ConstDefault::DEFAULT;
        if N::BUILDS {
            list = N::b_list(&self.lexer);
        }
        self.lexer.expect_less_than::<false>()?;

        loop {
            let mut argument = N::NONE;
            self.skip_type_script_type_with_opts::<N>(
                Level::Lowest,
                SkipTypeOptionsBitset::empty(),
                &mut argument,
            )?;
            if N::BUILDS {
                N::b_push_type(&mut list, N::node(&argument));
            }
            if self.lexer.token != T::TComma {
                break;
            }
            if N::BUILDS {
                N::b_separator(&self.lexer, &mut list);
            }
            self.lexer.next()?;
            // "A<B, >"
            if N::BUILDS && self.build_is_greater_than() {
                break;
            }
        }
        if N::BUILDS {
            arguments = N::b_close(&self.lexer, list);
        }

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
        Ok((true, arguments))
    }

    // ───────────────────────── Backtracking ─────────────────────────
    // Two concrete helpers covering the actual call patterns:
    //   - `lexer_backtracker_bool`   — fn returns Result<()>/Result<bool>, helper returns bool
    //   - `lexer_backtracker_result` — fn returns Result<SkipTypeParameterResult>

    #[inline]
    fn lexer_backtracker_bool<F, R>(&mut self, func: F) -> bool
    where
        F: FnOnce(&mut Self) -> Result<R, Error>,
    {
        self.mark_type_script_only();
        // The Lexer
        // holds `&mut Log`, so backtracking goes through a POD `LexerSnapshot` + `restore()`.
        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        let log = self.log();
        let (old_msgs_len, old_errors, old_warnings) = (log.msgs.len(), log.errors, log.warnings);
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
            // What the attempt logged without asking the lexer goes with it.
            let log = self.log();
            log.msgs.truncate(old_msgs_len);
            log.errors = old_errors;
            log.warnings = old_warnings;
        }
        self.lexer.is_log_disabled = old_log_disabled;

        !backtrack
    }

    #[inline]
    fn lexer_backtracker_result<F>(&mut self, func: F) -> SkipTypeParameterResult
    where
        F: FnOnce(&mut Self) -> Result<SkipTypeParameterResult, Error>,
    {
        self.mark_type_script_only();
        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        let log = self.log();
        let (old_msgs_len, old_errors, old_warnings) = (log.msgs.len(), log.errors, log.warnings);
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
            // `<out T>x`: the modifier that no type parameter of a function has is logged past the lexer
            let log = self.log();
            log.msgs.truncate(old_msgs_len);
            log.errors = old_errors;
            log.warnings = old_warnings;
        }
        self.lexer.is_log_disabled = old_log_disabled;

        result
    }

    /// As `lexer_backtracker_bool`, and what `func` returned where nothing went back.
    #[inline]
    fn lexer_backtracker_kept<F, R>(&mut self, func: F) -> Option<R>
    where
        F: FnOnce(&mut Self) -> Result<R, Error>,
    {
        self.mark_type_script_only();
        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        self.lexer.is_log_disabled = true;
        let kept = func(self).ok();
        if kept.is_none() {
            self.lexer.restore(&old_lexer);
        }
        self.lexer.is_log_disabled = old_log_disabled;
        kept
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

    pub(crate) fn skip_type_script_constraint_of_infer_type_with_backtracking<N: TypeSink>(
        &mut self,
        flags: SkipTypeOptionsBitset,
    ) -> Result<N::Out, Error> {
        self.lexer.expect(T::TExtends)?;
        let mut constraint = N::NONE;

        // The first constituent of the constraint: the caller reads the others after this attempt.
        let opts = SkipTypeOptionsBitset::only(SkipTypeOptions::DisallowConditionalTypes);
        if self.is_start_of_function_type_or_constructor_type() {
            self.parse_function_or_constructor_type::<N>(opts, &mut constraint)?;
        } else {
            self.parse_type_operator_or_higher::<N>(opts, &mut constraint)?;
        }

        if !flags.contains(SkipTypeOptions::DisallowConditionalTypes)
            && self.lexer.token == T::TQuestion
        {
            return Err(crate::Error::Backtrack);
        }

        Ok(constraint)
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

        self.skip_typescript_return_type()?;
        // Check the token after this and backtrack if it's the wrong one
        if self.lexer.token != T::TEqualsGreaterThan {
            return Err(crate::Error::Backtrack);
        }
        Ok(())
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
        let mut arrow_start = 0usize;
        let result: Result<(), Error> = (|| {
            self.lexer.expect(T::TColon)?;
            self.skip_typescript_return_type()?;
            arrow_start = self.lexer.start;
            self.parse_arrow_body(&mut [], &mut data)?;
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
        if is_arrow_fn {
            // The caller reads the return type again: a type in parentheses that ends it has this "=>" after it.
            self.set_type_script_memo_at(arrow_start, true);
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

    pub(crate) fn try_skip_type_script_constraint_of_infer_type_with_backtracking<N: TypeSink>(
        &mut self,
        flags: SkipTypeOptionsBitset,
    ) -> Result<(bool, N::Out), Error> {
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
            return Ok((false, N::NONE));
        }

        let mark = self.read_mark();
        let mut constraint = self.lexer_backtracker_kept(|p| {
            p.skip_type_script_constraint_of_infer_type_with_backtracking::<N>(flags)
        });
        if let Some(constraint_type) = &mut constraint {
            // tryParseConstraintOfInferType reads a whole type: here the other constituents.
            let opts = flags | SkipTypeOptions::DisallowConditionalTypes;
            let mut lead: KK<N, b::Lead> = ConstDefault::DEFAULT;
            self.parse_union_or_intersection_type_rest::<N, false>(
                opts,
                constraint_type,
                &mut lead,
            )?;
            self.parse_union_or_intersection_type_rest::<N, true>(
                opts,
                constraint_type,
                &mut lead,
            )?;

            // Before "?" and a type, the "extends" belongs to a conditional type.
            if !flags.contains(SkipTypeOptions::DisallowConditionalTypes)
                && self.lexer.token == T::TQuestion
                && self.look_ahead(Self::next_is_start_of_type)
            {
                self.rewind_to_read_mark(&mark);
                constraint = None;
            }
        }
        let skipped = constraint.is_some();
        if !skipped {
            // Re-search for the insertion point: attempts nested inside the one that
            // just failed may have added entries of their own.
            if let Err(insert_at) = self.ts_infer_constraint_backtracks.binary_search(&memo_key) {
                self.ts_infer_constraint_backtracks
                    .insert(insert_at, memo_key);
            }
        }
        Ok((skipped, constraint.unwrap_or(N::NONE)))
    }
}
