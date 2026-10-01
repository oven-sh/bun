#!/usr/bin/env python3
"""V2 = V1 + fewer tests where a sink builds no node. usage: patch_v2.py <root>"""
import sys
root = sys.argv[1] + '/src/js_parser/'
def sub(path, old, new, count=1):
    s = open(root + path).read()
    assert s.count(old) == count, (path, old[:70], s.count(old))
    open(root + path, 'w').write(s.replace(old, new))
F = 'parse/parse_skip_typescript.rs'

# a. one table for the tokens that go on with a type
sub(F, """/// A word that is no reserved word and that parseTypeMember tests for.""",
"""/// "!", "[" and ".": what `P::parse_postfix_type_rest` reads.
const TT_POSTFIX: u8 = 1;
/// "&", "|" and "extends": what follows an operand of `P::parse_type`.
const TT_OPERATOR: u8 = 2;
/// A word, ".", "<" and "<<": what follows the first name of a type reference.
const TT_AFTER_NAME: u8 = 4;

const fn type_token_flags() -> [u8; 256] {
    let mut flags = [0u8; 256];
    flags[T::TExclamation as usize] |= TT_POSTFIX;
    flags[T::TOpenBracket as usize] |= TT_POSTFIX;
    flags[T::TDot as usize] |= TT_POSTFIX | TT_AFTER_NAME;
    flags[T::TAmpersand as usize] |= TT_OPERATOR;
    flags[T::TBar as usize] |= TT_OPERATOR;
    flags[T::TExtends as usize] |= TT_OPERATOR;
    flags[T::TIdentifier as usize] |= TT_AFTER_NAME;
    flags[T::TLessThan as usize] |= TT_AFTER_NAME;
    flags[T::TLessThanLessThan as usize] |= TT_AFTER_NAME;
    flags
}

static TYPE_TOKEN_FLAGS: [u8; 256] = type_token_flags();

#[inline(always)]
fn type_token_has(token: T, flags: u8) -> bool {
    TYPE_TOKEN_FLAGS[token as u8 as usize] & flags != 0
}

/// What `P::parse_plain_primary` read.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Plain {
    /// Nothing: the token starts no name, no keyword type and no literal type.
    No,
    /// Nothing: the word is the name of a type operator or of a modifier.
    Special,
    /// A type that no token goes on with.
    Done,
    /// A type and what `P::parse_postfix_type_rest` reads after it.
    More,
}

/// A word that is no reserved word and that parseTypeMember tests for.""")

# b. the loop of parsePostfixTypeOrHigher: one test where nothing follows
sub(F, """    fn parse_postfix_type_rest<S: TypeSink>(&mut self, out: &mut S::Out) -> Result<(), Error> {
        loop {""", """    fn parse_postfix_type_rest<S: TypeSink>(&mut self, out: &mut S::Out) -> Result<(), Error> {
        if !type_token_has(self.lexer.token, TT_POSTFIX) {
            return Ok(());
        }
        loop {""")

# c. parseType: a name, a keyword type or a literal type is read with one test for what follows
sub(F, """        if !self.stack_check.is_safe_to_recurse() {
            return Err(Error::StackOverflow);
        }

        if self.is_start_of_function_type_or_constructor_type() {
            self.parse_function_or_constructor_type::<S>(opts, out)?;""",
"""        if !self.stack_check.is_safe_to_recurse() {
            return Err(Error::StackOverflow);
        }

        if !S::BUILDS {
            match self.parse_plain_primary::<S>(out)? {
                Plain::Done => return Ok(()),
                Plain::More => {
                    if !type_token_has(self.lexer.token, TT_OPERATOR) {
                        return Ok(());
                    }
                    let mut lead: KK<S, b::Lead> = ConstDefault::DEFAULT;
                    self.parse_union_or_intersection_type_rest::<S, false>(opts, out, &mut lead)?;
                    let mut lead: KK<S, b::Lead> = ConstDefault::DEFAULT;
                    self.parse_union_or_intersection_type_rest::<S, true>(opts, out, &mut lead)?;
                    if self.lexer.token == T::TExtends
                        && !self.lexer.has_newline_before
                        && !opts.contains(SkipTypeOptions::DisallowConditionalTypes)
                    {
                        self.parse_conditional_type_rest::<S>(out)?;
                    }
                    return Ok(());
                }
                Plain::Special => {
                    // "function f(keyof: any): keyof is string"
                    if opts.contains(SkipTypeOptions::IsReturnType)
                        && self.is_followed_by_is_keyword()
                        && self.skip_type_script_predicate_of_keyword_name()?
                    {
                        return Ok(());
                    }
                }
                Plain::No => {}
            }
        }

        if self.is_start_of_function_type_or_constructor_type() {
            self.parse_function_or_constructor_type::<S>(opts, out)?;""")

sub(F, """    /// The conditional type of `parseType`, from its "extends" on. `out` holds the check type.""",
"""    /// A name, a keyword type or a literal type with what follows it up to the operators, for a sink that builds no node.
    #[inline(always)]
    fn parse_plain_primary<S: TypeSink>(&mut self, out: &mut S::Out) -> Result<Plain, Error> {
        const AFTER: u8 = TT_AFTER_NAME | TT_POSTFIX | TT_OPERATOR;
        match self.lexer.token {
            T::TIdentifier => {
                let kind =
                    kind_for_identifier(self.lexer.identifier).unwrap_or(TsIdentKind::Normal);
                let keyword = match kind {
                    TsIdentKind::Normal => {
                        // parse_type_reference
                        S::reference(out, self.lexer.identifier, |name| {
                            self.find_symbol(bun_ast::Loc::EMPTY, name)
                                .map(|found| found.r#ref)
                        })?;
                        self.lexer.next()?;
                        if !type_token_has(self.lexer.token, AFTER) {
                            return Ok(Plain::Done);
                        }
                        if !self.parse_type_predicate_after_name::<S>(out)? {
                            self.parse_entity_name_rest::<S>(out)?;
                            self.parse_type_arguments_of_type_reference::<S>(out)?;
                        }
                        self.parse_postfix_type_rest::<S>(out)?;
                        return Ok(Plain::More);
                    }
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
                    _ => return Ok(Plain::Special),
                };
                // parse_keyword_type_node
                let name = self.lexer.identifier;
                let is_undefined = matches!(keyword, TypeKeyword::Undefined);
                self.lexer.next()?;
                S::keyword(out, keyword);
                if !type_token_has(self.lexer.token, AFTER) {
                    return Ok(Plain::Done);
                }
                if self.lexer.token == T::TDot {
                    if is_undefined {
                        S::keyword(out, TypeKeyword::Object);
                    } else {
                        S::reference(out, name, |name| {
                            self.find_symbol(bun_ast::Loc::EMPTY, name)
                                .map(|found| found.r#ref)
                        })?;
                    }
                }
                let _ = self.parse_type_predicate_after_name::<S>(out)?;
                self.parse_postfix_type_rest::<S>(out)?;
                Ok(Plain::More)
            }
            T::TStringLiteral
            | T::TNoSubstitutionTemplateLiteral
            | T::TNumericLiteral
            | T::TBigIntegerLiteral
            | T::TTrue
            | T::TFalse => {
                let literal = match self.lexer.token {
                    T::TNumericLiteral => TypeLiteral::Number,
                    T::TBigIntegerLiteral => TypeLiteral::Bigint,
                    T::TTrue | T::TFalse => TypeLiteral::Boolean,
                    _ => TypeLiteral::String,
                };
                self.lexer.next()?;
                S::literal(out, literal);
                if !type_token_has(self.lexer.token, TT_POSTFIX | TT_OPERATOR) {
                    return Ok(Plain::Done);
                }
                self.parse_postfix_type_rest::<S>(out)?;
                Ok(Plain::More)
            }
            T::TNull | T::TVoid => {
                let keyword = if self.lexer.token == T::TNull {
                    TypeKeyword::Null
                } else {
                    TypeKeyword::Void
                };
                self.lexer.next()?;
                S::keyword(out, keyword);
                if !type_token_has(self.lexer.token, TT_POSTFIX | TT_OPERATOR) {
                    return Ok(Plain::Done);
                }
                self.parse_postfix_type_rest::<S>(out)?;
                Ok(Plain::More)
            }
            _ => Ok(Plain::No),
        }
    }

    /// The conditional type of `parseType`, from its "extends" on. `out` holds the check type.""")

# d. an operand after "|" or "&": the same reading
sub(F, """    ) -> Result<(), Error> {
        if self.is_start_of_function_type_or_constructor_type() {
            self.parse_function_or_constructor_type::<S>(opts, out)?;
            if S::STRICT {""", """    ) -> Result<(), Error> {
        if !S::BUILDS {
            match self.parse_plain_primary::<S>(out)? {
                Plain::Done => return Ok(()),
                Plain::More => {
                    if IS_UNION && self.lexer.token == T::TAmpersand {
                        let mut lead: KK<S, b::Lead> = ConstDefault::DEFAULT;
                        self.parse_union_or_intersection_type_rest::<S, false>(
                            opts, out, &mut lead,
                        )?;
                    }
                    return Ok(());
                }
                Plain::Special | Plain::No => {}
            }
        }
        if self.is_start_of_function_type_or_constructor_type() {
            self.parse_function_or_constructor_type::<S>(opts, out)?;
            if S::STRICT {""")

# e. the return type: the word before "is" is tested where its kind is known
sub(F, """        // "function f(keyof: any): keyof is string"
        if self.lexer.token == T::TIdentifier
            && self.is_followed_by_is_keyword()
            && self.skip_type_script_predicate_of_keyword_name()?
        {
            return Ok(());
        }
        self.skip_type_script_type_with_opts::<Discard>(""", """        self.skip_type_script_type_with_opts::<Discard>(""")

# f. a member that starts with a word that is no modifier
sub(F, """    fn parse_type_member(&mut self) -> Result<(), Error> {
        // "+" or "-" is accepted before any member, not only before "readonly" of a mapped type""",
"""    fn parse_type_member(&mut self) -> Result<(), Error> {
        if self.lexer.token == T::TIdentifier && MEMBER_KEYWORD_MAP.get(self.lexer.raw()).is_none() {
            self.lexer.next()?;
            return self.parse_property_or_method_signature(MemberName::Word, false);
        }
        // "+" or "-" is accepted before any member, not only before "readonly" of a mapped type""")

# g. a word starts a type
sub(F, """    fn is_word_that_starts_no_type(&mut self) -> bool {
        match self.lexer.token {""", """    fn is_word_that_starts_no_type(&mut self) -> bool {
        if self.lexer.token == T::TIdentifier {
            return false;
        }
        match self.lexer.token {""")

# h. the label of a tuple element: the bytes after the word say whether a token has to be read ahead
sub(F, """            && (self.lexer.token == T::TDotDotDot || self.lexer.is_identifier_or_keyword())
            && self.look_ahead(Self::scan_start_of_named_tuple_element)
        {""", """            && (self.lexer.token == T::TDotDotDot || self.lexer.is_identifier_or_keyword())
            && self.is_start_of_named_tuple_element()
        {""")
sub(F, """    /// A reserved word that starts no type is reported and read as a label, as before.""",
"""    /// `lookAhead(scanStartOfNamedTupleElement)`. After a word, blanks and then ":" or "?" decide without a token.
    #[inline]
    fn is_start_of_named_tuple_element(&mut self) -> bool {
        if self.lexer.token != T::TDotDotDot {
            let contents = self.lexer.contents;
            let mut i = self.lexer.end;
            while matches!(contents.get(i), Some(b' ' | b'\\t' | b'\\n' | b'\\r')) {
                i += 1;
            }
            match contents.get(i) {
                Some(b':') => return true,
                Some(b'?' | b'/') => {}
                Some(byte) if *byte > b' ' && *byte < 0x7f => return false,
                _ => {}
            }
        }
        self.look_ahead(Self::scan_start_of_named_tuple_element)
    }

    /// A reserved word that starts no type is reported and read as a label, as before.""")
print('v2 patched')
