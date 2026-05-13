use crate::js_lexer::T;
use crate::p::P;

// Zig: `p: anytype` for the generic parser instance. Round-C lowered NewParser_ →
// `P<'a, const TS, const SCAN>`. The Phase-A draft used unbounded `<P>` which
// can't access fields; convert to `impl P` methods. The `Metadata::*` methods that need
// `p.load_name_from_ref` take a closure to avoid the impl-on-foreign-type problem.

// This function is taken from the official TypeScript compiler source code:
// https://github.com/microsoft/TypeScript/blob/master/src/compiler/parser.ts
impl<'a, const TS: bool, const SCAN: bool> P<'a, TS, SCAN> {
    pub fn can_follow_type_arguments_in_expression(&mut self) -> bool {
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
    // TODO(port): narrow error set — only `lexer.next()` is fallible here.
    pub fn is_ts_arrow_fn_jsx(&mut self) -> Result<bool, bun_core::Error> {
        let p = self;
        // PORT NOTE: Zig `const old = p.lexer` (value copy). Rust Lexer holds `&mut Log`
        // so cannot Clone; use the LexerSnapshot POD via `snapshot()`/`restore()`.
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
        // PORT NOTE: Zig value-copied the Lexer; use snapshot()/restore() (see is_ts_arrow_fn_jsx).
        let old_lexer = p.lexer.snapshot();
        let old_log_disabled = p.lexer.is_log_disabled;
        p.lexer.is_log_disabled = true;

        let _ = p.lexer.next();

        let result = matches!(p.lexer.token, T::TOpenParen | T::TLessThan | T::TDot);

        // PORT NOTE: Zig used `defer` for restore; reshaped to linear since there is
        // no early return between the defer and end of scope.
        p.lexer.restore(&old_lexer);
        p.lexer.is_log_disabled = old_log_disabled;

        result
    }

    // This function is taken from the official TypeScript compiler source code:
    // https://github.com/microsoft/TypeScript/blob/master/src/compiler/parser.ts
    // PORT NOTE: renamed `ts_is_identifier` to avoid clash with lexer/P helpers of the same name.
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
    pub enum StmtIdentifier {
        SType,

        SNamespace,

        SAbstract,

        SModule,

        SInterface,

        SDeclare,
    }

    pub fn for_str(str: &[u8]) -> Option<StmtIdentifier> {
        match str.len() {
            // "type".len
            4 => {
                if str == b"type" {
                    Some(StmtIdentifier::SType)
                } else {
                    None
                }
            }
            // "interface".len == "namespace".len
            9 => {
                if str == b"interface" {
                    Some(StmtIdentifier::SInterface)
                } else if str == b"namespace" {
                    Some(StmtIdentifier::SNamespace)
                } else {
                    None
                }
            }
            // "abstract".len
            8 => {
                if str == b"abstract" {
                    Some(StmtIdentifier::SAbstract)
                } else {
                    None
                }
            }
            // "declare".len
            7 => {
                if str == b"declare" {
                    Some(StmtIdentifier::SDeclare)
                } else {
                    None
                }
            }
            // "module".len
            6 => {
                if str == b"module" {
                    Some(StmtIdentifier::SModule)
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    // PERF(port): was `phf::Map<&[u8], Kind>`. phf hashes the full identifier
    // (SipHash) on every TIdentifier in a TS type position — including the
    // overwhelmingly-common miss case (a user-defined type name). With only
    // 16 entries spanning lengths 3..=9, a length gate rejects almost every
    // miss on a single usize compare, and hits resolve in ≤2 slice compares.
    // Length 6 is the only cluster (6 entries) so it gets a first-byte
    // sub-dispatch. Mirrors the `clap::find_param` pattern (12577e958d71).
    #[inline]
    pub fn kind_for_identifier(ident: &[u8]) -> Option<Kind> {
        match ident.len() {
            3 => {
                if ident == b"any" {
                    return Some(Kind::PrimitiveAny);
                }
            }
            5 => {
                if ident == b"keyof" {
                    return Some(Kind::PrefixKeyof);
                }
                if ident == b"never" {
                    return Some(Kind::PrimitiveNever);
                }
                if ident == b"infer" {
                    return Some(Kind::Infer);
                }
            }
            6 => match ident[0] {
                b'u' if ident == b"unique" => return Some(Kind::Unique),
                b'o' if ident == b"object" => return Some(Kind::PrimitiveObject),
                b'n' if ident == b"number" => return Some(Kind::PrimitiveNumber),
                b'b' if ident == b"bigint" => return Some(Kind::PrimitiveBigint),
                b's' => {
                    if ident == b"string" {
                        return Some(Kind::PrimitiveString);
                    }
                    if ident == b"symbol" {
                        return Some(Kind::PrimitiveSymbol);
                    }
                }
                _ => {}
            },
            7 => {
                if ident == b"unknown" {
                    return Some(Kind::PrimitiveUnknown);
                }
                if ident == b"boolean" {
                    return Some(Kind::PrimitiveBoolean);
                }
                if ident == b"asserts" {
                    return Some(Kind::Asserts);
                }
            }
            8 => {
                if ident == b"abstract" {
                    return Some(Kind::Abstract);
                }
                if ident == b"readonly" {
                    return Some(Kind::PrefixReadonly);
                }
            }
            9 => {
                if ident == b"undefined" {
                    return Some(Kind::PrimitiveUndefined);
                }
            }
            _ => {}
        }
        None
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

// PORT NOTE: Zig nested `Bitset` and `empty` inside `SkipTypeOptions`. Rust
// inherent associated types (`impl Foo { type Bar = ...; }`) are unstable
// (`inherent_associated_types`), so the alias and empty constant are hoisted
// to module scope.
pub type SkipTypeOptionsBitset = enumset::EnumSet<SkipTypeOptions>;
pub const SKIP_TYPE_OPTIONS_EMPTY: SkipTypeOptionsBitset = enumset::EnumSet::empty();

// ported from: src/js_parser/ast/TypeScript.zig
