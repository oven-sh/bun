//! `ABIType` — the FFI C-type tag enum, its label table, and the C/JS
//! source-code formatters. Single source of truth: must be kept in sync with
//! `JSFFIFunction.h`.

use core::fmt;

use bstr::BStr;

// ═════════════════════════════════════════════════════════════════════════════
// ABIType — must be kept in sync with JSFFIFunction.h
// ═════════════════════════════════════════════════════════════════════════════

#[repr(i32)]
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ABIType {
    Char = 0,

    Int8T = 1,
    Uint8T = 2,

    Int16T = 3,
    Uint16T = 4,

    Int32T = 5,
    Uint32T = 6,

    Int64T = 7,
    Uint64T = 8,

    Double = 9,
    Float = 10,

    Bool = 11,

    Ptr = 12,

    Void = 13,

    CString = 14,

    I64Fast = 15,
    U64Fast = 16,

    Function = 17,
    NapiEnv = 18,
    NapiValue = 19,
    Buffer = 20,
}

bun_core::comptime_string_map! {
    /// String-to-tag lookup table for `args:`/`returns:`
    /// option parsing. Associated `static` items aren't allowed in Rust, so the
    /// table lives at module scope and is re-exposed as `ABIType::LABEL` so callers
    /// can keep using `ABIType::LABEL.get(...)` (auto-deref handles the reference).
    pub static ABI_TYPE_LABEL: ABIType = {
    b"bool" => ABIType::Bool,
    b"c_int" => ABIType::Int32T,
    b"c_uint" => ABIType::Uint32T,
    b"char" => ABIType::Char,
    b"char*" => ABIType::Ptr,
    b"double" => ABIType::Double,
    b"f32" => ABIType::Float,
    b"f64" => ABIType::Double,
    b"float" => ABIType::Float,
    b"i16" => ABIType::Int16T,
    b"i32" => ABIType::Int32T,
    b"i64" => ABIType::Int64T,
    b"i8" => ABIType::Int8T,
    b"int" => ABIType::Int32T,
    b"int16_t" => ABIType::Int16T,
    b"int32_t" => ABIType::Int32T,
    b"int64_t" => ABIType::Int64T,
    b"int8_t" => ABIType::Int8T,
    b"isize" => ABIType::Int64T,
    b"u16" => ABIType::Uint16T,
    b"u32" => ABIType::Uint32T,
    b"u64" => ABIType::Uint64T,
    b"u8" => ABIType::Uint8T,
    b"uint16_t" => ABIType::Uint16T,
    b"uint32_t" => ABIType::Uint32T,
    b"uint64_t" => ABIType::Uint64T,
    b"uint8_t" => ABIType::Uint8T,
    b"usize" => ABIType::Uint64T,
    b"size_t" => ABIType::Uint64T,
    b"buffer" => ABIType::Buffer,
    b"void*" => ABIType::Ptr,
    b"ptr" => ABIType::Ptr,
    b"pointer" => ABIType::Ptr,
    b"void" => ABIType::Void,
    b"cstring" => ABIType::CString,
    b"i64_fast" => ABIType::I64Fast,
    b"u64_fast" => ABIType::U64Fast,
    b"function" => ABIType::Function,
    b"callback" => ABIType::Function,
    b"fn" => ABIType::Function,
    b"napi_env" => ABIType::NapiEnv,
    b"napi_value" => ABIType::NapiValue,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-variant string table — single source of truth for the four exhaustive
// matches that previously lived in typename_label / param_typename_label /
// ToCFormatter / ToJSFormatter. Indexed by `self as usize` (discriminants are
// contiguous 0..=20).
// ─────────────────────────────────────────────────────────────────────────────

struct AbiRow {
    /// C type name for return/decl position (`typename_label`).
    c_type: &'static [u8],
    /// `(T)` cast prefix emitted by `ToCFormatter` when `exact` is set. Empty
    /// when no cast is wanted (Buffer) or the row is unreachable (Void/Napi*).
    to_c_cast: &'static str,
    /// `JSVALUE_TO_*( ` macro head. `None` for the three early-return arms
    /// (Void / NapiEnv / NapiValue) handled inline by `ToCFormatter`.
    to_c_macro: Option<&'static str>,
    /// `(prefix, suffix)` wrapping the symbol in `ToJSFormatter`. `None` for
    /// the three special arms (Void / NapiEnv / Buffer) handled inline.
    to_js: Option<(&'static str, &'static str)>,
}

#[rustfmt::skip]
static ABI_TABLE: [AbiRow; 21] = {
    const fn r(
        c_type: &'static [u8],
        to_c_cast: &'static str,
        to_c_macro: Option<&'static str>,
        to_js: Option<(&'static str, &'static str)>,
    ) -> AbiRow {
        AbiRow { c_type, to_c_cast, to_c_macro, to_js }
    }
    [
    /* Char      */ r(b"char",       "(char)",     Some("JSVALUE_TO_INT32("),               Some(("INT32_TO_JSVALUE((int32_t)", ")"))),
    /* Int8T     */ r(b"int8_t",     "(int8_t)",   Some("JSVALUE_TO_INT32("),               Some(("INT32_TO_JSVALUE((int32_t)", ")"))),
    /* Uint8T    */ r(b"uint8_t",    "(uint8_t)",  Some("JSVALUE_TO_INT32("),               Some(("INT32_TO_JSVALUE((int32_t)", ")"))),
    /* Int16T    */ r(b"int16_t",    "(int16_t)",  Some("JSVALUE_TO_INT32("),               Some(("INT32_TO_JSVALUE((int32_t)", ")"))),
    /* Uint16T   */ r(b"uint16_t",   "(uint16_t)", Some("JSVALUE_TO_INT32("),               Some(("INT32_TO_JSVALUE((int32_t)", ")"))),
    /* Int32T    */ r(b"int32_t",    "(int32_t)",  Some("JSVALUE_TO_INT32("),               Some(("INT32_TO_JSVALUE((int32_t)", ")"))),
    /* Uint32T   */ r(b"uint32_t",   "(uint32_t)", Some("JSVALUE_TO_INT32("),               Some(("UINT32_TO_JSVALUE(", ")"))),
    /* Int64T    */ r(b"int64_t",    "(int64_t)",  Some("JSVALUE_TO_INT64("),               Some(("INT64_TO_JSVALUE_SLOW(JS_GLOBAL_OBJECT, ", ")"))),
    /* Uint64T   */ r(b"uint64_t",   "(uint64_t)", Some("JSVALUE_TO_UINT64("),              Some(("UINT64_TO_JSVALUE_SLOW(JS_GLOBAL_OBJECT, ", ")"))),
    /* Double    */ r(b"double",     "(double)",   Some("JSVALUE_TO_DOUBLE("),              Some(("DOUBLE_TO_JSVALUE(", ")"))),
    /* Float     */ r(b"float",      "(float)",    Some("JSVALUE_TO_FLOAT("),               Some(("FLOAT_TO_JSVALUE(", ")"))),
    /* Bool      */ r(b"bool",       "(bool)",     Some("JSVALUE_TO_BOOL("),                Some(("BOOLEAN_TO_JSVALUE(", ")"))),
    /* Ptr       */ r(b"void*",      "(void*)",    Some("JSVALUE_TO_PTR("),                 Some(("PTR_TO_JSVALUE(", ")"))),
    /* Void      */ r(b"void",       "",           None,                                    None),
    /* CString   */ r(b"void*",      "(void*)",    Some("JSVALUE_TO_PTR("),                 Some(("PTR_TO_JSVALUE(", ")"))),
    /* I64Fast   */ r(b"int64_t",    "(int64_t)",  Some("JSVALUE_TO_INT64("),               Some(("INT64_TO_JSVALUE(JS_GLOBAL_OBJECT, (int64_t)", ")"))),
    /* U64Fast   */ r(b"uint64_t",   "(uint64_t)", Some("JSVALUE_TO_UINT64("),              Some(("UINT64_TO_JSVALUE(JS_GLOBAL_OBJECT, ", ")"))),
    /* Function  */ r(b"void*",      "(void*)",    Some("JSVALUE_TO_PTR("),                 Some(("PTR_TO_JSVALUE(", ")"))),
    /* NapiEnv   */ r(b"napi_env",   "",           None,                                    None),
    /* NapiValue */ r(b"napi_value", "",           None,                                    Some(("((EncodedJSValue) {.asNapiValue = ", " } )"))),
    /* Buffer    */ r(b"void*",      "",           Some("JSVALUE_TO_TYPED_ARRAY_VECTOR("),  None),
    ]
};

impl ABIType {
    #[inline]
    fn row(self) -> &'static AbiRow {
        &ABI_TABLE[self as usize]
    }
}

impl ABIType {
    /// See [`ABI_TYPE_LABEL`].
    pub const LABEL: &'static __ComptimeStringMap_ABI_TYPE_LABEL = &ABI_TYPE_LABEL;

    /// Returns `None` for out-of-range discriminants.
    #[inline]
    pub const fn from_int(n: i32) -> Option<Self> {
        Some(match n {
            0 => Self::Char,
            1 => Self::Int8T,
            2 => Self::Uint8T,
            3 => Self::Int16T,
            4 => Self::Uint16T,
            5 => Self::Int32T,
            6 => Self::Uint32T,
            7 => Self::Int64T,
            8 => Self::Uint64T,
            9 => Self::Double,
            10 => Self::Float,
            11 => Self::Bool,
            12 => Self::Ptr,
            13 => Self::Void,
            14 => Self::CString,
            15 => Self::I64Fast,
            16 => Self::U64Fast,
            17 => Self::Function,
            18 => Self::NapiEnv,
            19 => Self::NapiValue,
            20 => Self::Buffer,
            _ => return None,
        })
    }

    /// Types that we can directly pass through as an `int64_t`
    pub fn needs_a_cast_in_c(self) -> bool {
        !matches!(
            self,
            ABIType::Char
                | ABIType::Int8T
                | ABIType::Uint8T
                | ABIType::Int16T
                | ABIType::Uint16T
                | ABIType::Int32T
                | ABIType::Uint32T
        )
    }

    pub fn is_floating_point(self) -> bool {
        matches!(self, ABIType::Double | ABIType::Float)
    }

    pub fn to_c(self, symbol: &[u8]) -> ToCFormatter<'_> {
        ToCFormatter {
            tag: self,
            symbol,
            exact: false,
        }
    }

    pub fn to_c_exact(self, symbol: &[u8]) -> ToCFormatter<'_> {
        ToCFormatter {
            tag: self,
            symbol,
            exact: true,
        }
    }

    pub fn to_js(self, symbol: &[u8]) -> ToJSFormatter<'_> {
        ToJSFormatter { tag: self, symbol }
    }

    pub fn typename(self, writer: &mut impl std::io::Write) -> Result<(), crate::Error> {
        writer.write_all(self.typename_label())?;
        Ok(())
    }

    pub fn typename_label(self) -> &'static [u8] {
        self.row().c_type
    }

    pub fn param_typename(self, writer: &mut impl std::io::Write) -> Result<(), crate::Error> {
        writer.write_all(self.typename_label())?;
        Ok(())
    }
}

pub struct ToCFormatter<'a> {
    pub symbol: &'a [u8],
    pub tag: ABIType,
    pub exact: bool,
}

impl fmt::Display for ToCFormatter<'_> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        let row = self.tag.row();
        let Some(macro_) = row.to_c_macro else {
            return match self.tag {
                ABIType::Void => Ok(()),
                ABIType::NapiEnv => writer.write_str("((napi_env)&Bun__thisFFIModuleNapiEnv)"),
                ABIType::NapiValue => write!(writer, "{}.asNapiValue", BStr::new(self.symbol)),
                _ => unreachable!(),
            };
        };
        if self.exact && !row.to_c_cast.is_empty() {
            writer.write_str(row.to_c_cast)?;
        }
        writer.write_str(macro_)?;
        fmt::Display::fmt(BStr::new(self.symbol), writer)?;
        writer.write_str(")")
    }
}

pub struct ToJSFormatter<'a> {
    pub symbol: &'a [u8],
    pub tag: ABIType,
}

impl fmt::Display for ToJSFormatter<'_> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.tag.row().to_js {
            Some((pre, suf)) => write!(writer, "{pre}{}{suf}", BStr::new(self.symbol)),
            None => match self.tag {
                ABIType::Void => Ok(()),
                ABIType::NapiEnv => writer.write_str("((napi_env)&Bun__thisFFIModuleNapiEnv)"),
                ABIType::Buffer => writer.write_str("0"),
                _ => unreachable!(),
            },
        }
    }
}
