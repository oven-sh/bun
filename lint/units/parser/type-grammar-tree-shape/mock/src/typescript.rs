#![allow(dead_code)]
use crate::lexer::T;
use crate::p::P;

impl<'a, const TS: bool, const SCAN: bool> P<'a, TS, SCAN> {
    pub(crate) fn can_follow_type_arguments_in_expression(&mut self) -> bool {
        let p = self;
        match p.lexer.token {
            T::TOpenParen | T::TNoSubstitutionTemplateLiteral | T::TTemplateHead => true,
            T::TLessThan | T::TGreaterThan | T::TPlus | T::TMinus | T::TGreaterThanEquals | T::TGreaterThanGreaterThan
            | T::TGreaterThanGreaterThanEquals | T::TGreaterThanGreaterThanGreaterThan | T::TGreaterThanGreaterThanGreaterThanEquals => false,
            _ => p.lexer.has_newline_before || p.is_binary_operator() || !p.is_start_of_expression(),
        }
    }
    fn is_binary_operator(&self) -> bool {
        let p = self;
        match p.lexer.token {
            T::TIn => true,
            T::TQuestionQuestion | T::TBarBar | T::TAmpersandAmpersand | T::TBar | T::TCaret | T::TAmpersand | T::TEqualsEquals
            | T::TExclamationEquals | T::TEqualsEqualsEquals | T::TExclamationEqualsEquals | T::TLessThan | T::TGreaterThan
            | T::TLessThanEquals | T::TGreaterThanEquals | T::TInstanceof | T::TLessThanLessThan | T::TGreaterThanGreaterThan
            | T::TGreaterThanGreaterThanGreaterThan | T::TPlus | T::TMinus | T::TAsterisk | T::TSlash | T::TPercent | T::TAsteriskAsterisk => true,
            T::TIdentifier => p.lexer.is_contextual_keyword(b"as") || p.lexer.is_contextual_keyword(b"satisfies"),
            _ => false,
        }
    }
    fn is_start_of_left_hand_side_expression(&mut self) -> bool {
        matches!(self.lexer.token, T::TThis | T::TSuper | T::TNull | T::TTrue | T::TFalse | T::TNumericLiteral | T::TBigIntegerLiteral
            | T::TStringLiteral | T::TNoSubstitutionTemplateLiteral | T::TTemplateHead | T::TOpenParen | T::TOpenBracket | T::TOpenBrace
            | T::TFunction | T::TClass | T::TNew | T::TSlash | T::TSlashEquals | T::TIdentifier | T::TImport)
    }
    fn is_start_of_expression(&mut self) -> bool {
        if self.is_start_of_left_hand_side_expression() { return true; }
        match self.lexer.token {
            T::TPlus | T::TMinus | T::TTilde | T::TExclamation | T::TDelete | T::TTypeof | T::TVoid | T::TPlusPlus | T::TMinusMinus
            | T::TLessThan | T::TPrivateIdentifier | T::TAt => true,
            _ => self.is_binary_operator(),
        }
    }
}

pub mod identifier {
    #[inline]
    pub(crate) fn kind_for_identifier(ident: &[u8]) -> Option<Kind> {
        Some(match ident {
            b"any" => Kind::PrimitiveAny, b"keyof" => Kind::PrefixKeyof, b"never" => Kind::PrimitiveNever, b"infer" => Kind::Infer,
            b"unique" => Kind::Unique, b"object" => Kind::PrimitiveObject, b"number" => Kind::PrimitiveNumber,
            b"bigint" => Kind::PrimitiveBigint, b"string" => Kind::PrimitiveString, b"symbol" => Kind::PrimitiveSymbol,
            b"unknown" => Kind::PrimitiveUnknown, b"boolean" => Kind::PrimitiveBoolean, b"asserts" => Kind::Asserts,
            b"abstract" => Kind::Abstract, b"readonly" => Kind::PrefixReadonly, b"undefined" => Kind::PrimitiveUndefined,
            _ => return None,
        })
    }
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub enum Kind {
        Normal, Unique, Abstract, Asserts, PrefixKeyof, PrefixReadonly, PrimitiveAny, PrimitiveNever, PrimitiveUnknown,
        PrimitiveUndefined, PrimitiveObject, PrimitiveNumber, PrimitiveString, PrimitiveBoolean, PrimitiveBigint, PrimitiveSymbol, Infer,
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SkipTypeOptions { IsReturnType, IsIndexSignature, AllowTupleLabels, DisallowConditionalTypes }

/// Mock of `enumset::EnumSet<SkipTypeOptions>`: only the calls the real set has.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct EnumSet(u8);
impl EnumSet {
    pub fn only(o: SkipTypeOptions) -> Self { EnumSet(1 << (o as u8)) }
    pub fn empty() -> Self { EnumSet(0) }
    pub fn contains(&self, o: SkipTypeOptions) -> bool { self.0 & (1 << (o as u8)) != 0 }
}
pub(crate) type SkipTypeOptionsBitset = EnumSet;

impl core::ops::BitOr<SkipTypeOptions> for EnumSet { type Output = EnumSet; fn bitor(self, o: SkipTypeOptions) -> EnumSet { EnumSet(self.0 | (1 << (o as u8))) } }
impl core::ops::BitOr<EnumSet> for EnumSet { type Output = EnumSet; fn bitor(self, o: EnumSet) -> EnumSet { EnumSet(self.0 | o.0) } }
