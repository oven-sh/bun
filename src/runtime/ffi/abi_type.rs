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
    BufferLength = 21,
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
    b"buffer_length" => ABIType::BufferLength,
    b"buffer_bytelength" => ABIType::BufferLength,
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
// Per-variant string table — single source of truth for typename_label /
// ToCFormatter / ToJSFormatter. Indexed by `self as usize`.
// ─────────────────────────────────────────────────────────────────────────────

/// The `FFI.h` function a generated wrapper converts an argument with.
enum ToC {
    /// Written out by [`ToCFormatter`] itself, or not an argument type.
    Special,
    /// `f(arg)`; cannot fail.
    Infallible(&'static str),
    /// `f(JS_GLOBAL_OBJECT, ABI_TYPE_*, &threw, arg)`; may throw via `JSVALUE_TO_SLOT_SLOW`.
    Fallible(&'static str),
}

struct AbiRow {
    c_type: &'static [u8],
    /// `#define`d to the discriminant (also the engine's type tag) by `Function::compile`.
    tag_define: &'static str,
    to_c: ToC,
    to_js: Option<(&'static str, &'static str)>,
}

const ABI_TYPE_COUNT: usize = 22;

#[rustfmt::skip]
static ABI_TABLE: [AbiRow; ABI_TYPE_COUNT] = {
    use ToC::*;
    const fn r(
        c_type: &'static [u8],
        tag_define: &'static str,
        to_c: ToC,
        to_js: Option<(&'static str, &'static str)>,
    ) -> AbiRow {
        AbiRow { c_type, tag_define, to_c, to_js }
    }
    [
    /* Char      */ r(b"char",       "ABI_TYPE_CHAR",          Infallible("JSVALUE_TO_INT32"),               Some(("INT32_TO_JSVALUE((int32_t)", ")"))),
    /* Int8T     */ r(b"int8_t",     "ABI_TYPE_I8",            Infallible("JSVALUE_TO_INT32"),               Some(("INT32_TO_JSVALUE((int32_t)", ")"))),
    /* Uint8T    */ r(b"uint8_t",    "ABI_TYPE_U8",            Infallible("JSVALUE_TO_INT32"),               Some(("INT32_TO_JSVALUE((int32_t)", ")"))),
    /* Int16T    */ r(b"int16_t",    "ABI_TYPE_I16",           Infallible("JSVALUE_TO_INT32"),               Some(("INT32_TO_JSVALUE((int32_t)", ")"))),
    /* Uint16T   */ r(b"uint16_t",   "ABI_TYPE_U16",           Infallible("JSVALUE_TO_INT32"),               Some(("INT32_TO_JSVALUE((int32_t)", ")"))),
    /* Int32T    */ r(b"int32_t",    "ABI_TYPE_I32",           Infallible("JSVALUE_TO_INT32"),               Some(("INT32_TO_JSVALUE((int32_t)", ")"))),
    /* Uint32T   */ r(b"uint32_t",   "ABI_TYPE_U32",           Infallible("JSVALUE_TO_INT32"),               Some(("UINT32_TO_JSVALUE(", ")"))),
    /* Int64T    */ r(b"int64_t",    "ABI_TYPE_I64",           Fallible("JSVALUE_TO_INT64"),                 Some(("INT64_TO_JSVALUE_SLOW(JS_GLOBAL_OBJECT, ", ")"))),
    /* Uint64T   */ r(b"uint64_t",   "ABI_TYPE_U64",           Fallible("JSVALUE_TO_UINT64"),                Some(("UINT64_TO_JSVALUE_SLOW(JS_GLOBAL_OBJECT, ", ")"))),
    /* Double    */ r(b"double",     "ABI_TYPE_F64",           Infallible("JSVALUE_TO_DOUBLE"),              Some(("DOUBLE_TO_JSVALUE(", ")"))),
    /* Float     */ r(b"float",      "ABI_TYPE_F32",           Infallible("JSVALUE_TO_FLOAT"),               Some(("FLOAT_TO_JSVALUE(", ")"))),
    /* Bool      */ r(b"bool",       "ABI_TYPE_BOOL",          Infallible("JSVALUE_TO_BOOL"),                Some(("BOOLEAN_TO_JSVALUE(", ")"))),
    /* Ptr       */ r(b"void*",      "ABI_TYPE_PTR",           Infallible("JSVALUE_TO_PTR"),                 Some(("PTR_TO_JSVALUE(", ")"))),
    /* Void      */ r(b"void",       "ABI_TYPE_VOID",          Special,                                      None),
    /* CString   */ r(b"void*",      "ABI_TYPE_CSTRING",       Infallible("JSVALUE_TO_PTR"),                 Some(("PTR_TO_JSVALUE(", ")"))),
    /* I64Fast   */ r(b"int64_t",    "ABI_TYPE_I64_FAST",      Fallible("JSVALUE_TO_INT64"),                 Some(("INT64_TO_JSVALUE(JS_GLOBAL_OBJECT, (int64_t)", ")"))),
    /* U64Fast   */ r(b"uint64_t",   "ABI_TYPE_U64_FAST",      Fallible("JSVALUE_TO_UINT64"),                Some(("UINT64_TO_JSVALUE(JS_GLOBAL_OBJECT, ", ")"))),
    /* Function  */ r(b"void*",      "ABI_TYPE_FUNCTION",      Infallible("JSVALUE_TO_PTR"),                 Some(("PTR_TO_JSVALUE(", ")"))),
    /* NapiEnv   */ r(b"napi_env",   "ABI_TYPE_NAPI_ENV",      Special,                                      None),
    /* NapiValue */ r(b"napi_value", "ABI_TYPE_NAPI_VALUE",    Special,                                      Some(("((EncodedJSValue) {.asNapiValue = ", " } )"))),
    /* Buffer    */ r(b"void*",      "ABI_TYPE_BUFFER",        Infallible("JSVALUE_TO_TYPED_ARRAY_VECTOR"),  None),
    /* BufferLen */ r(b"uint64_t",   "ABI_TYPE_BUFFER_LENGTH", Special,                                      None),
    ]
};

impl ABIType {
    #[inline]
    fn row(self) -> &'static AbiRow {
        &ABI_TABLE[self as usize]
    }
}

impl ABIType {
    pub(crate) const MAX: i32 = ABIType::NapiValue as i32;

    /// See [`ABI_TYPE_LABEL`].
    pub(crate) const LABEL: &'static __ComptimeStringMap_ABI_TYPE_LABEL = &ABI_TYPE_LABEL;

    /// One [`AbiRow::tag_define`] per variant, for `define_symbols`.
    pub(crate) fn tag_defines() -> [(&'static str, i64); ABI_TYPE_COUNT] {
        core::array::from_fn(|i| (ABI_TABLE[i].tag_define, i as i64))
    }

    /// Returns `None` for out-of-range discriminants.
    #[inline]
    pub(crate) const fn from_int(n: i32) -> Option<Self> {
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
            21 => Self::BufferLength,
            _ => return None,
        })
    }

    /// Types that we can directly pass through as an `int64_t`
    pub(crate) fn needs_a_cast_in_c(self) -> bool {
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

    pub(crate) fn is_floating_point(self) -> bool {
        matches!(self, ABIType::Double | ABIType::Float)
    }

    /// See [`ToC::Fallible`].
    pub(crate) fn arg_conversion_can_throw(self) -> bool {
        matches!(self.row().to_c, ToC::Fallible(_))
    }

    pub(crate) fn to_c(self, symbol: &[u8]) -> ToCFormatter<'_> {
        ToCFormatter { tag: self, symbol }
    }

    pub(crate) fn to_js(self, symbol: &[u8]) -> ToJSFormatter<'_> {
        ToJSFormatter { tag: self, symbol }
    }

    pub(crate) fn typename(self, writer: &mut impl std::io::Write) -> Result<(), crate::Error> {
        writer.write_all(self.typename_label())?;
        Ok(())
    }

    pub(crate) fn typename_label(self) -> &'static [u8] {
        self.row().c_type
    }
}

pub(crate) struct ToCFormatter<'a> {
    pub(crate) symbol: &'a [u8],
    pub(crate) tag: ABIType,
}

impl fmt::Display for ToCFormatter<'_> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        let row = self.tag.row();
        let symbol = BStr::new(self.symbol);
        match row.to_c {
            ToC::Infallible(function) => write!(writer, "{function}({symbol})"),
            ToC::Fallible(function) => write!(
                writer,
                "{function}(JS_GLOBAL_OBJECT, {}, &threw, {symbol})",
                row.tag_define
            ),
            ToC::Special => match self.tag {
                ABIType::Void => Ok(()),
                ABIType::NapiEnv => writer.write_str("((napi_env)&Bun__thisFFIModuleNapiEnv)"),
                ABIType::NapiValue => write!(writer, "{symbol}.asNapiValue"),
                _ => unreachable!(),
            },
        }
    }
}

pub(crate) struct ToJSFormatter<'a> {
    pub(crate) symbol: &'a [u8],
    pub(crate) tag: ABIType,
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
