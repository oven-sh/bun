use crate::js_lexer::T;
use crate::Ref;

// TODO(port): `p: anytype` in the Zig source is the generic parser instance
// (NewParser with comptime options). Phase B must either define a `ParserLike`
// trait exposing `lexer`, `allow_in`, `fn_or_arrow_data_parse`,
// `load_name_from_ref`, or thread the concrete parser type. For Phase A these
// functions are written against an unbounded `<P>` and access fields directly.

// This function is taken from the official TypeScript compiler source code:
// https://github.com/microsoft/TypeScript/blob/master/src/compiler/parser.ts
pub fn can_follow_type_arguments_in_expression<P>(p: &mut P) -> bool {
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
        _ => p.lexer.has_newline_before || is_binary_operator(p) || !is_start_of_expression(p),
    }
}

#[derive(Clone)]
pub enum Metadata {
    MNone,

    MNever,
    MUnknown,
    MAny,
    MVoid,
    MNull,
    MUndefined,
    MFunction,
    MArray,
    MBoolean,
    MString,
    MObject,
    MNumber,
    MBigint,
    MSymbol,
    MPromise,
    MIdentifier(Ref),
    // TODO(port): Zig used `std.ArrayListUnmanaged(Ref)`. This is an AST crate;
    // if this list is arena-backed in practice, switch to
    // `bumpalo::collections::Vec<'bump, Ref>` in Phase B.
    MDot(Vec<Ref>),
}

impl Default for Metadata {
    fn default() -> Self {
        Metadata::MNone
    }
}

impl Metadata {
    pub const DEFAULT: Self = Metadata::MNone;

    // the logic in finish_union, merge_union, finish_intersection and merge_intersection is
    // translated from:
    // https://github.com/microsoft/TypeScript/blob/e0a324b0503be479f2b33fd2e17c6e86c94d1297/src/compiler/transformers/typeSerializer.ts#L402

    /// Return the final union type if possible, or return None to continue merging.
    ///
    /// If the current type is MNever, MNull, or MUndefined assign the current type
    /// to MNone and return None to ensure it's always replaced by the next type.
    pub fn finish_union<P>(current: &mut Self, p: &P) -> Option<Self> {
        match current {
            Metadata::MIdentifier(r) => {
                if p.load_name_from_ref(*r) == b"Object" {
                    return Some(Metadata::MObject);
                }
                None
            }

            Metadata::MUnknown | Metadata::MAny | Metadata::MObject => Some(Metadata::MObject),

            Metadata::MNever | Metadata::MNull | Metadata::MUndefined => {
                *current = Metadata::MNone;
                None
            }

            _ => None,
        }
    }

    pub fn merge_union(result: &mut Self, left: Self) {
        if !matches!(left, Metadata::MNone) {
            if core::mem::discriminant(result) != core::mem::discriminant(&left) {
                *result = match result {
                    Metadata::MNever | Metadata::MUndefined | Metadata::MNull => left,

                    _ => Metadata::MObject,
                };
            } else {
                // PORT NOTE: reshaped for borrowck — copy Ref out before reassigning *result
                if let Metadata::MIdentifier(r) = result {
                    let r = *r;
                    if let Metadata::MIdentifier(l) = left {
                        if !r.eql(l) {
                            *result = Metadata::MObject;
                        }
                    }
                }
            }
        } else {
            // always take the next value if left is MNone
        }
    }

    /// Return the final intersection type if possible, or return None to continue merging.
    ///
    /// If the current type is MUnknown, MNull, or MUndefined assign the current type
    /// to MNone and return None to ensure it's always replaced by the next type.
    pub fn finish_intersection<P>(current: &mut Self, p: &P) -> Option<Self> {
        match current {
            Metadata::MIdentifier(r) => {
                if p.load_name_from_ref(*r) == b"Object" {
                    return Some(Metadata::MObject);
                }
                None
            }

            // ensure MNever is the final type
            Metadata::MNever => Some(Metadata::MNever),

            Metadata::MAny | Metadata::MObject => Some(Metadata::MObject),

            Metadata::MUnknown | Metadata::MNull | Metadata::MUndefined => {
                *current = Metadata::MNone;
                None
            }

            _ => None,
        }
    }

    pub fn merge_intersection(result: &mut Self, left: Self) {
        if !matches!(left, Metadata::MNone) {
            if core::mem::discriminant(result) != core::mem::discriminant(&left) {
                *result = match result {
                    Metadata::MUnknown | Metadata::MUndefined | Metadata::MNull => left,

                    // ensure MNever is the final type
                    Metadata::MNever => Metadata::MNever,

                    _ => Metadata::MObject,
                };
            } else {
                // PORT NOTE: reshaped for borrowck — copy Ref out before reassigning *result
                if let Metadata::MIdentifier(r) = result {
                    let r = *r;
                    if let Metadata::MIdentifier(l) = left {
                        if !r.eql(l) {
                            *result = Metadata::MObject;
                        }
                    }
                }
            }
        } else {
            // make sure intersection of only MUnknown serializes to "undefined"
            // instead of "Object"
            if matches!(result, Metadata::MUnknown) {
                *result = Metadata::MUndefined;
            }
        }
    }
}

// TODO(port): narrow error set — only `lexer.next()` is fallible here.
pub fn is_ts_arrow_fn_jsx<P>(p: &mut P) -> Result<bool, bun_core::Error> {
    // TODO(port): Zig copied the lexer by value (`const old_lexer = p.lexer`).
    // Assumes the Rust `Lexer` is `Clone` (snapshot pattern).
    let old_lexer = p.lexer.clone();

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
fn is_binary_operator<P>(p: &P) -> bool {
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
fn is_start_of_left_hand_side_expression<P>(p: &mut P) -> bool {
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
        T::TImport => look_ahead_next_token_is_open_paren_or_less_than_or_dot(p),
        _ => is_identifier(p),
    }
}

fn look_ahead_next_token_is_open_paren_or_less_than_or_dot<P>(p: &mut P) -> bool {
    // TODO(port): see note in is_ts_arrow_fn_jsx re: Lexer snapshot/Clone.
    let old_lexer = p.lexer.clone();
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
fn is_identifier<P>(p: &P) -> bool {
    if p.lexer.token == T::TIdentifier {
        // If we have a 'yield' keyword, and we're in the [yield] context, then 'yield' is
        // considered a keyword and is not an identifier.
        // TODO(port): `AllowIdent` variant name must match the port of FnOrArrowDataParse.
        if p.fn_or_arrow_data_parse.allow_yield != AllowIdent && p.lexer.identifier == b"yield" {
            return false;
        }

        // If we have an 'await' keyword, and we're in the [await] context, then 'await' is
        // considered a keyword and is not an identifier.
        if p.fn_or_arrow_data_parse.allow_await != AllowIdent && p.lexer.identifier == b"await" {
            return false;
        }

        return true;
    }

    false
}

fn is_start_of_expression<P>(p: &mut P) -> bool {
    if is_start_of_left_hand_side_expression(p) {
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
            if is_binary_operator(p) {
                return true;
            }

            is_identifier(p)
        }
    }
}

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

    pub static IMAP: phf::Map<&'static [u8], Kind> = phf::phf_map! {
        b"unique" => Kind::Unique,
        b"abstract" => Kind::Abstract,
        b"asserts" => Kind::Asserts,

        b"keyof" => Kind::PrefixKeyof,
        b"readonly" => Kind::PrefixReadonly,

        b"any" => Kind::PrimitiveAny,
        b"never" => Kind::PrimitiveNever,
        b"unknown" => Kind::PrimitiveUnknown,
        b"undefined" => Kind::PrimitiveUndefined,
        b"object" => Kind::PrimitiveObject,
        b"number" => Kind::PrimitiveNumber,
        b"string" => Kind::PrimitiveString,
        b"boolean" => Kind::PrimitiveBoolean,
        b"bigint" => Kind::PrimitiveBigint,
        b"symbol" => Kind::PrimitiveSymbol,

        b"infer" => Kind::Infer,
    };

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
pub const SKIP_TYPE_OPTIONS_EMPTY: SkipTypeOptionsBitset = enumset::EnumSet::EMPTY;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/TypeScript.zig (472 lines)
//   confidence: medium
//   todos:      6
//   notes:      `p: anytype` left as unbounded generic <P> — Phase B must define a Parser trait or thread the concrete parser type; lexer Token (T) variant casing assumed PascalCase.
// ──────────────────────────────────────────────────────────────────────────
