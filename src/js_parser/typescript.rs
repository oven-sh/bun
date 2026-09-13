use crate::js_lexer::T;
use crate::p::P;

// The `Metadata::*` methods that need `p.load_name_from_ref` take a closure to
// avoid the impl-on-foreign-type problem.

// This function is taken from the official TypeScript compiler source code:
// https://github.com/microsoft/TypeScript/blob/master/src/compiler/parser.ts
impl<'a, const TS: bool, const SCAN: bool> P<'a, TS, SCAN> {
    pub(crate) fn can_follow_type_arguments_in_expression(&mut self) -> bool {
        let p = self;
        match p.lexer.token {
        // These are the only tokens can legally follow a type argument list. So we
        // definitely want to treat them as type arg lists.
        T::TOpenParen // foo<x>(
        | T::TNoSubstitutionTemplateLiteral // foo<T> `...`
        // foo<T> `...${100}...`
        | T::TTemplateHead => true,

        // A type argument list followed by `<` never makes sense, and a type argument list followed
        // by `>` is ambiguous with a (re-scanned) `>>` operator, so we disqualify both. Also, in
        // this context, `+` and `-` are unary operators, not binary operators.
        T::TLessThan
        | T::TGreaterThan
        | T::TPlus
        | T::TMinus
        // TypeScript always sees "t_greater_than" instead of these tokens since
        // their scanner works a little differently than our lexer. So since
        // "t_greater_than" is forbidden above, we also forbid these too.
        | T::TGreaterThanEquals
        | T::TGreaterThanGreaterThan
        | T::TGreaterThanGreaterThanEquals
        | T::TGreaterThanGreaterThanGreaterThan
        | T::TGreaterThanGreaterThanGreaterThanEquals => false,

        // We favor the type argument list interpretation when it is immediately followed by
        // a line break, a binary operator, or something that can't start an expression.
        _ => p.lexer.has_newline_before || p.is_binary_operator() || !p.is_start_of_expression(),
    }
    }
} // end impl P (can_follow_type_arguments_in_expression)

impl<'a, const TS: bool, const SCAN: bool> P<'a, TS, SCAN> {
    pub(crate) fn is_ts_arrow_fn_jsx(&mut self) -> crate::CrateResult<bool> {
        let p = self;
        // Lexer holds `&mut Log` so it cannot Clone; use the LexerSnapshot POD
        // via `snapshot()`/`restore()`.
        let old_lexer = p.lexer.snapshot();

        p.lexer.next()?;
        // Look ahead to see if this should be an arrow function instead
        let mut is_ts_arrow_fn = false;

        if p.lexer.token == T::TConst {
            p.lexer.next()?;
        }
        if p.lexer.token == T::TIdentifier {
            p.lexer.next()?;
            if p.lexer.token == T::TComma || p.lexer.token == T::TEquals {
                is_ts_arrow_fn = true;
            } else if p.lexer.token == T::TExtends {
                p.lexer.next()?;
                is_ts_arrow_fn = p.lexer.token != T::TEquals
                    && p.lexer.token != T::TGreaterThan
                    && p.lexer.token != T::TSlash;
            }
        }

        // Restore the lexer
        p.lexer.restore(&old_lexer);
        Ok(is_ts_arrow_fn)
    }

    // This function is taken from the official TypeScript compiler source code:
    // https://github.com/microsoft/TypeScript/blob/master/src/compiler/parser.ts
    fn is_binary_operator(&self) -> bool {
        let p = self;
        match p.lexer.token {
            T::TIn => p.allow_in,

            T::TQuestionQuestion
            | T::TBarBar
            | T::TAmpersandAmpersand
            | T::TBar
            | T::TCaret
            | T::TAmpersand
            | T::TEqualsEquals
            | T::TExclamationEquals
            | T::TEqualsEqualsEquals
            | T::TExclamationEqualsEquals
            | T::TLessThan
            | T::TGreaterThan
            | T::TLessThanEquals
            | T::TGreaterThanEquals
            | T::TInstanceof
            | T::TLessThanLessThan
            | T::TGreaterThanGreaterThan
            | T::TGreaterThanGreaterThanGreaterThan
            | T::TPlus
            | T::TMinus
            | T::TAsterisk
            | T::TSlash
            | T::TPercent
            | T::TAsteriskAsterisk => true,
            T::TIdentifier => {
                p.lexer.is_contextual_keyword(b"as") || p.lexer.is_contextual_keyword(b"satisfies")
            }
            _ => false,
        }
    }

    // This function is taken from the official TypeScript compiler source code:
    // https://github.com/microsoft/TypeScript/blob/master/src/compiler/parser.ts
    fn is_start_of_left_hand_side_expression(&mut self) -> bool {
        let p = self;
        match p.lexer.token {
            T::TThis
            | T::TSuper
            | T::TNull
            | T::TTrue
            | T::TFalse
            | T::TNumericLiteral
            | T::TBigIntegerLiteral
            | T::TStringLiteral
            | T::TNoSubstitutionTemplateLiteral
            | T::TTemplateHead
            | T::TOpenParen
            | T::TOpenBracket
            | T::TOpenBrace
            | T::TFunction
            | T::TClass
            | T::TNew
            | T::TSlash
            | T::TSlashEquals
            | T::TIdentifier => true,
            T::TImport => p.look_ahead_next_token_is_open_paren_or_less_than_or_dot(),
            _ => p.ts_is_identifier(),
        }
    }

    fn look_ahead_next_token_is_open_paren_or_less_than_or_dot(&mut self) -> bool {
        let p = self;
        let old_lexer = p.lexer.snapshot();
        let old_log_disabled = p.lexer.is_log_disabled;
        p.lexer.is_log_disabled = true;

        let _ = p.lexer.next();

        let result = matches!(p.lexer.token, T::TOpenParen | T::TLessThan | T::TDot);

        p.lexer.restore(&old_lexer);
        p.lexer.is_log_disabled = old_log_disabled;

        result
    }

    // This function is taken from the official TypeScript compiler source code:
    // https://github.com/microsoft/TypeScript/blob/master/src/compiler/parser.ts
    // renamed `ts_is_identifier` to avoid clash with lexer/P helpers of the same name.
    fn ts_is_identifier(&self) -> bool {
        use crate::parser::AwaitOrYield::AllowIdent;
        let p = self;
        if p.lexer.token == T::TIdentifier {
            // If we have a 'yield' keyword, and we're in the [yield] context, then 'yield' is
            // considered a keyword and is not an identifier.
            if p.fn_or_arrow_data_parse.allow_yield != AllowIdent && p.lexer.identifier == b"yield"
            {
                return false;
            }

            // If we have an 'await' keyword, and we're in the [await] context, then 'await' is
            // considered a keyword and is not an identifier.
            if p.fn_or_arrow_data_parse.allow_await != AllowIdent && p.lexer.identifier == b"await"
            {
                return false;
            }

            return true;
        }

        false
    }

    fn is_start_of_expression(&mut self) -> bool {
        let p = self;
        if p.is_start_of_left_hand_side_expression() {
            return true;
        }

        match p.lexer.token {
            T::TPlus
            | T::TMinus
            | T::TTilde
            | T::TExclamation
            | T::TDelete
            | T::TTypeof
            | T::TVoid
            | T::TPlusPlus
            | T::TMinusMinus
            | T::TLessThan
            | T::TPrivateIdentifier
            | T::TAt => true,
            _ => {
                if p.lexer.token == T::TIdentifier
                    && (p.lexer.identifier == b"await" || p.lexer.identifier == b"yield")
                {
                    // Yield/await always starts an expression.  Either it is an identifier (in which case
                    // it is definitely an expression).  Or it's a keyword (either because we're in
                    // a generator or async function, or in strict mode (or both)) and it started a yield or await expression.
                    return true;
                }

                // Error tolerance.  If we see the start of some binary operator, we consider
                // that the start of an expression.  That way we'll parse out a missing identifier,
                // give a good message about an identifier being missing, and then consume the
                // rest of the binary expression.
                if p.is_binary_operator() {
                    return true;
                }

                p.ts_is_identifier()
            }
        }
    }
} // end impl P (predicate fns)

pub mod identifier {
    #[derive(Clone, Copy)]
    pub(crate) enum StmtIdentifier {
        SType,

        SNamespace,

        SAbstract,

        SModule,

        SInterface,

        SDeclare,
    }

    bun_core::comptime_string_map! {
        static STMT_IDENTIFIER_MAP: StmtIdentifier = {
            b"type" => StmtIdentifier::SType,
            b"namespace" => StmtIdentifier::SNamespace,
            b"abstract" => StmtIdentifier::SAbstract,
            b"module" => StmtIdentifier::SModule,
            b"interface" => StmtIdentifier::SInterface,
            b"declare" => StmtIdentifier::SDeclare,
        };
    }

    pub(crate) fn for_str(str: &[u8]) -> Option<StmtIdentifier> {
        STMT_IDENTIFIER_MAP.get(str).copied()
    }

    // PERF: hot path — probed for every TIdentifier in a TS type position,
    // where the overwhelmingly-common case is a miss (a user-defined type
    // name). The comptime_string_map lookup rejects most misses on the
    // length dispatch alone and never hashes.
    bun_core::comptime_string_map! {
        static KIND_MAP: Kind = {
            b"any" => Kind::PrimitiveAny,
            b"keyof" => Kind::PrefixKeyof,
            b"never" => Kind::PrimitiveNever,
            b"infer" => Kind::Infer,
            b"unique" => Kind::Unique,
            b"object" => Kind::PrimitiveObject,
            b"number" => Kind::PrimitiveNumber,
            b"bigint" => Kind::PrimitiveBigint,
            b"string" => Kind::PrimitiveString,
            b"symbol" => Kind::PrimitiveSymbol,
            b"unknown" => Kind::PrimitiveUnknown,
            b"boolean" => Kind::PrimitiveBoolean,
            b"asserts" => Kind::Asserts,
            b"abstract" => Kind::Abstract,
            b"readonly" => Kind::PrefixReadonly,
            b"undefined" => Kind::PrimitiveUndefined,
        };
    }

    #[inline]
    pub(crate) fn kind_for_identifier(ident: &[u8]) -> Option<Kind> {
        KIND_MAP.get(ident).copied()
    }

    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum Kind {
        Normal,
        Unique,
        Abstract,
        Asserts,
        PrefixKeyof,
        PrefixReadonly,
        PrimitiveAny,
        PrimitiveNever,
        PrimitiveUnknown,
        PrimitiveUndefined,
        PrimitiveObject,
        PrimitiveNumber,
        PrimitiveString,
        PrimitiveBoolean,
        PrimitiveBigint,
        PrimitiveSymbol,
        Infer,
    }
}

#[derive(enumset::EnumSetType)]
pub enum SkipTypeOptions {
    IsReturnType,
    IsIndexSignature,
    AllowTupleLabels,
    DisallowConditionalTypes,
}

// Inherent associated types (`impl Foo { type Bar = ...; }`) are unstable
// (`inherent_associated_types`), so the alias and empty constant are hoisted
// to module scope.
pub(crate) type SkipTypeOptionsBitset = enumset::EnumSet<SkipTypeOptions>;
