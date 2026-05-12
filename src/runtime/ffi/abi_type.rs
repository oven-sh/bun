//! `ABIType` — the FFI C-type tag enum, its label table, and the C/JS
//! source-code formatters. Single source of truth: must be kept in sync with
//! `JSFFIFunction.h`. Ported once from `src/runtime/ffi/ffi.zig:2006`
//! (`pub const ABIType = enum(i32) { ... }`).

use core::fmt;

use bstr::BStr;

// ═════════════════════════════════════════════════════════════════════════════
// ABIType — must be kept in sync with JSFFIFunction.h
// ═════════════════════════════════════════════════════════════════════════════

#[repr(i32)]
#[derive(Copy, Clone, PartialEq, Eq, Debug, strum::IntoStaticStr)]
pub enum ABIType {
    #[strum(serialize = "char")]
    Char = 0,

    #[strum(serialize = "int8_t")]
    Int8T = 1,
    #[strum(serialize = "uint8_t")]
    Uint8T = 2,

    #[strum(serialize = "int16_t")]
    Int16T = 3,
    #[strum(serialize = "uint16_t")]
    Uint16T = 4,

    #[strum(serialize = "int32_t")]
    Int32T = 5,
    #[strum(serialize = "uint32_t")]
    Uint32T = 6,

    #[strum(serialize = "int64_t")]
    Int64T = 7,
    #[strum(serialize = "uint64_t")]
    Uint64T = 8,

    #[strum(serialize = "double")]
    Double = 9,
    #[strum(serialize = "float")]
    Float = 10,

    #[strum(serialize = "bool")]
    Bool = 11,

    #[strum(serialize = "ptr")]
    Ptr = 12,

    #[strum(serialize = "void")]
    Void = 13,

    #[strum(serialize = "cstring")]
    CString = 14,

    #[strum(serialize = "i64_fast")]
    I64Fast = 15,
    #[strum(serialize = "u64_fast")]
    U64Fast = 16,

    #[strum(serialize = "function")]
    Function = 17,
    #[strum(serialize = "napi_env")]
    NapiEnv = 18,
    #[strum(serialize = "napi_value")]
    NapiValue = 19,
    #[strum(serialize = "buffer")]
    Buffer = 20,
}

/// Zig `ABIType.label` — string-to-tag lookup table for `args:`/`returns:`
/// option parsing. Associated `static` items aren't allowed in Rust, so the
/// table lives at module scope and is re-exposed as `ABIType::LABEL` so callers
/// can keep using `ABIType::LABEL.get(...)` (auto-deref handles the `&phf::Map`).
pub static ABI_TYPE_LABEL: phf::Map<&'static [u8], ABIType> = phf::phf_map! {
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

impl ABIType {
    pub const MAX: i32 = ABIType::NapiValue as i32;

    /// See [`ABI_TYPE_LABEL`].
    pub const LABEL: &'static phf::Map<&'static [u8], ABIType> = &ABI_TYPE_LABEL;

    // TODO(port): map_to_js_object — Zig builds a comptime "{...}" string from
    // `map` via EnumMapFormatter. Rust cannot iterate phf at const time;
    // generate via build.rs or const_format! in Phase B.
    pub const MAP_TO_JS_OBJECT: &'static str = "";

    /// Zig `std.enums.fromInt(ABIType, int) orelse ...` — returns `None` for
    /// out-of-range discriminants. The enum is `#[repr(i32)]` with contiguous
    /// values `0..=MAX` plus `Buffer = 20`, so range-check then match.
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
        ToCFormatter { tag: self, symbol, exact: false }
    }

    pub fn to_c_exact(self, symbol: &[u8]) -> ToCFormatter<'_> {
        ToCFormatter { tag: self, symbol, exact: true }
    }

    pub fn to_js(self, symbol: &[u8]) -> ToJSFormatter<'_> {
        ToJSFormatter { tag: self, symbol }
    }

    pub fn typename(self, writer: &mut impl std::io::Write) -> Result<(), bun_core::Error> {
        writer.write_all(self.typename_label())?;
        Ok(())
    }

    pub fn typename_label(self) -> &'static [u8] {
        match self {
            ABIType::Buffer | ABIType::Function | ABIType::CString | ABIType::Ptr => b"void*",
            ABIType::Bool => b"bool",
            ABIType::Int8T => b"int8_t",
            ABIType::Uint8T => b"uint8_t",
            ABIType::Int16T => b"int16_t",
            ABIType::Uint16T => b"uint16_t",
            ABIType::Int32T => b"int32_t",
            ABIType::Uint32T => b"uint32_t",
            ABIType::I64Fast | ABIType::Int64T => b"int64_t",
            ABIType::U64Fast | ABIType::Uint64T => b"uint64_t",
            ABIType::Double => b"double",
            ABIType::Float => b"float",
            ABIType::Char => b"char",
            ABIType::Void => b"void",
            ABIType::NapiEnv => b"napi_env",
            ABIType::NapiValue => b"napi_value",
        }
    }

    pub fn param_typename(self, writer: &mut impl std::io::Write) -> Result<(), bun_core::Error> {
        writer.write_all(self.typename_label())?;
        Ok(())
    }

    pub fn param_typename_label(self) -> &'static [u8] {
        match self {
            ABIType::Function | ABIType::CString | ABIType::Ptr => b"void*",
            ABIType::Bool => b"bool",
            ABIType::Int8T => b"int8_t",
            ABIType::Uint8T => b"uint8_t",
            ABIType::Int16T => b"int16_t",
            ABIType::Uint16T => b"uint16_t",
            // see the comment in ffi.ts about why `uint32_t` acts as `int32_t`
            ABIType::Int32T | ABIType::Uint32T => b"int32_t",
            ABIType::I64Fast | ABIType::Int64T => b"int64_t",
            ABIType::U64Fast | ABIType::Uint64T => b"uint64_t",
            ABIType::Double => b"double",
            ABIType::Float => b"float",
            ABIType::Char => b"char",
            ABIType::Void => b"void",
            ABIType::NapiEnv => b"napi_env",
            ABIType::NapiValue => b"napi_value",
            ABIType::Buffer => b"buffer",
        }
    }
}

pub struct EnumMapFormatter<'a> {
    pub name: &'a [u8],
    pub entry: ABIType,
}

impl fmt::Display for EnumMapFormatter<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("['")?;
        // these are not all valid identifiers
        fmt::Display::fmt(BStr::new(self.name), f)?;
        f.write_str("']:")?;
        write!(f, "{}", self.entry as i32)?;
        f.write_str(",'")?;
        write!(f, "{}", self.entry as i32)?;
        f.write_str("':")?;
        write!(f, "{}", self.entry as i32)
    }
}

pub struct ToCFormatter<'a> {
    pub symbol: &'a [u8],
    pub tag: ABIType,
    pub exact: bool,
}

impl fmt::Display for ToCFormatter<'_> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.tag {
            ABIType::Void => return Ok(()),
            ABIType::Bool => {
                if self.exact {
                    writer.write_str("(bool)")?;
                }
                writer.write_str("JSVALUE_TO_BOOL(")?;
            }
            ABIType::Char
            | ABIType::Int8T
            | ABIType::Uint8T
            | ABIType::Int16T
            | ABIType::Uint16T
            | ABIType::Int32T
            | ABIType::Uint32T => {
                if self.exact {
                    write!(writer, "({})", <&'static str>::from(self.tag))?;
                }
                writer.write_str("JSVALUE_TO_INT32(")?;
            }
            ABIType::I64Fast | ABIType::Int64T => {
                if self.exact {
                    writer.write_str("(int64_t)")?;
                }
                writer.write_str("JSVALUE_TO_INT64(")?;
            }
            ABIType::U64Fast | ABIType::Uint64T => {
                if self.exact {
                    writer.write_str("(uint64_t)")?;
                }
                writer.write_str("JSVALUE_TO_UINT64(")?;
            }
            ABIType::Function | ABIType::CString | ABIType::Ptr => {
                if self.exact {
                    writer.write_str("(void*)")?;
                }
                writer.write_str("JSVALUE_TO_PTR(")?;
            }
            ABIType::Double => {
                if self.exact {
                    writer.write_str("(double)")?;
                }
                writer.write_str("JSVALUE_TO_DOUBLE(")?;
            }
            ABIType::Float => {
                if self.exact {
                    writer.write_str("(float)")?;
                }
                writer.write_str("JSVALUE_TO_FLOAT(")?;
            }
            ABIType::NapiEnv => {
                writer.write_str("((napi_env)&Bun__thisFFIModuleNapiEnv)")?;
                return Ok(());
            }
            ABIType::NapiValue => {
                fmt::Display::fmt(BStr::new(self.symbol), writer)?;
                writer.write_str(".asNapiValue")?;
                return Ok(());
            }
            ABIType::Buffer => {
                writer.write_str("JSVALUE_TO_TYPED_ARRAY_VECTOR(")?;
            }
        }
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
        let sym = BStr::new(self.symbol);
        match self.tag {
            ABIType::Void => Ok(()),
            ABIType::Bool => write!(writer, "BOOLEAN_TO_JSVALUE({})", sym),
            ABIType::Char
            | ABIType::Int8T
            | ABIType::Uint8T
            | ABIType::Int16T
            | ABIType::Uint16T
            | ABIType::Int32T => write!(writer, "INT32_TO_JSVALUE((int32_t){})", sym),
            ABIType::Uint32T => write!(writer, "UINT32_TO_JSVALUE({})", sym),
            ABIType::I64Fast => {
                write!(writer, "INT64_TO_JSVALUE(JS_GLOBAL_OBJECT, (int64_t){})", sym)
            }
            ABIType::Int64T => {
                write!(writer, "INT64_TO_JSVALUE_SLOW(JS_GLOBAL_OBJECT, {})", sym)
            }
            ABIType::U64Fast => {
                write!(writer, "UINT64_TO_JSVALUE(JS_GLOBAL_OBJECT, {})", sym)
            }
            ABIType::Uint64T => {
                write!(writer, "UINT64_TO_JSVALUE_SLOW(JS_GLOBAL_OBJECT, {})", sym)
            }
            ABIType::Function | ABIType::CString | ABIType::Ptr => {
                write!(writer, "PTR_TO_JSVALUE({})", sym)
            }
            ABIType::Double => write!(writer, "DOUBLE_TO_JSVALUE({})", sym),
            ABIType::Float => write!(writer, "FLOAT_TO_JSVALUE({})", sym),
            ABIType::NapiEnv => writer.write_str("((napi_env)&Bun__thisFFIModuleNapiEnv)"),
            ABIType::NapiValue => {
                write!(writer, "((EncodedJSValue) {{.asNapiValue = {} }} )", sym)
            }
            ABIType::Buffer => writer.write_str("0"),
        }
    }
}
