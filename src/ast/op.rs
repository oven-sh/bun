use enum_map::Enum;
use strum::IntoStaticStr;

use crate::AssignTarget;

// If you add a new token, remember to add it to "TABLE" too
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug, Enum, IntoStaticStr)]
#[strum(serialize_all = "snake_case")] // match Zig @tagName output (e.g. "bin_add")
pub enum Code {
    // Prefix
    UnPos, // +expr
    UnNeg, // -expr
    UnCpl, // ~expr
    UnNot, // !expr
    UnVoid,
    UnTypeof,
    UnDelete,

    // Prefix update
    UnPreDec,
    UnPreInc,

    // Postfix update
    UnPostDec,
    UnPostInc,

    /// Left-associative
    BinAdd,
    /// Left-associative
    BinSub,
    /// Left-associative
    BinMul,
    /// Left-associative
    BinDiv,
    /// Left-associative
    BinRem,
    /// Left-associative
    BinPow,
    /// Left-associative
    BinLt,
    /// Left-associative
    BinLe,
    /// Left-associative
    BinGt,
    /// Left-associative
    BinGe,
    /// Left-associative
    BinIn,
    /// Left-associative
    BinInstanceof,
    /// Left-associative
    BinShl,
    /// Left-associative
    BinShr,
    /// Left-associative
    BinUShr,
    /// Left-associative
    BinLooseEq,
    /// Left-associative
    BinLooseNe,
    /// Left-associative
    BinStrictEq,
    /// Left-associative
    BinStrictNe,
    /// Left-associative
    BinNullishCoalescing,
    /// Left-associative
    BinLogicalOr,
    /// Left-associative
    BinLogicalAnd,
    /// Left-associative
    BinBitwiseOr,
    /// Left-associative
    BinBitwiseAnd,
    /// Left-associative
    BinBitwiseXor,

    /// Non-associative
    BinComma,

    /// Right-associative
    BinAssign,
    /// Right-associative
    BinAddAssign,
    /// Right-associative
    BinSubAssign,
    /// Right-associative
    BinMulAssign,
    /// Right-associative
    BinDivAssign,
    /// Right-associative
    BinRemAssign,
    /// Right-associative
    BinPowAssign,
    /// Right-associative
    BinShlAssign,
    /// Right-associative
    BinShrAssign,
    /// Right-associative
    BinUShrAssign,
    /// Right-associative
    BinBitwiseOrAssign,
    /// Right-associative
    BinBitwiseAndAssign,
    /// Right-associative
    BinBitwiseXorAssign,
    /// Right-associative
    BinNullishCoalescingAssign,
    /// Right-associative
    BinLogicalOrAssign,
    /// Right-associative
    BinLogicalAndAssign,
}

impl Code {
    // Zig std.json.Stringify hook → write the tag name as a JSON string.
    pub fn json_stringify<W: crate::JsonWriter>(
        self,
        writer: &mut W,
    ) -> Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(self))
    }

    pub fn unary_assign_target(code: Code) -> AssignTarget {
        if (code as u8) >= (Code::UnPreDec as u8) && (code as u8) <= (Code::UnPostInc as u8) {
            return AssignTarget::Update;
        }

        AssignTarget::None
    }

    pub fn is_left_associative(code: Code) -> bool {
        (code as u8) >= (Code::BinAdd as u8)
            && (code as u8) < (Code::BinComma as u8)
            && code != Code::BinPow
    }

    pub fn is_right_associative(code: Code) -> bool {
        (code as u8) >= (Code::BinAssign as u8) || code == Code::BinPow
    }

    pub fn binary_assign_target(self) -> AssignTarget {
        let code = self;
        if code == Code::BinAssign {
            return AssignTarget::Replace;
        }

        if (code as u8) > (Code::BinAssign as u8) {
            return AssignTarget::Update;
        }

        AssignTarget::None
    }

    pub fn is_prefix(code: Code) -> bool {
        (code as u8) < (Code::UnPostDec as u8)
    }
}

#[repr(u8)] // Zig: enum(u6) — Rust has no u6, u8 is the narrowest fit
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Level {
    Lowest,
    Comma,
    Spread,
    Yield,
    Assign,
    Conditional,
    NullishCoalescing,
    LogicalOr,
    LogicalAnd,
    BitwiseOr,
    BitwiseXor,
    BitwiseAnd,
    Equals,
    Compare,
    Shift,
    Add,
    Multiply,
    Exponentiation,
    Prefix,
    Postfix,
    New,
    Call,
    Member,
}

impl Level {
    #[inline]
    pub fn lt(self, b: Level) -> bool {
        (self as u8) < (b as u8)
    }
    #[inline]
    pub fn gt(self, b: Level) -> bool {
        (self as u8) > (b as u8)
    }
    #[inline]
    pub fn gte(self, b: Level) -> bool {
        (self as u8) >= (b as u8)
    }
    #[inline]
    pub fn lte(self, b: Level) -> bool {
        (self as u8) <= (b as u8)
    }
    #[inline]
    pub fn eql(self, b: Level) -> bool {
        (self as u8) == (b as u8)
    }

    #[inline]
    pub fn sub(self, i: u8) -> Level {
        Level::from_raw((self as u8) - i)
    }

    #[inline]
    pub fn add_f(self, i: u8) -> Level {
        Level::from_raw((self as u8) + i)
    }

    #[inline]
    const fn from_raw(n: u8) -> Level {
        // Callers only pass values derived from a valid `Level` discriminant
        // ±1 (`sub`/`add_f`); decode by exhaustive match so an out-of-range
        // shift traps in release too (matches Zig's safety-checked
        // `@enumFromInt`) instead of fabricating an invalid discriminant.
        match n {
            0 => Level::Lowest,
            1 => Level::Comma,
            2 => Level::Spread,
            3 => Level::Yield,
            4 => Level::Assign,
            5 => Level::Conditional,
            6 => Level::NullishCoalescing,
            7 => Level::LogicalOr,
            8 => Level::LogicalAnd,
            9 => Level::BitwiseOr,
            10 => Level::BitwiseXor,
            11 => Level::BitwiseAnd,
            12 => Level::Equals,
            13 => Level::Compare,
            14 => Level::Shift,
            15 => Level::Add,
            16 => Level::Multiply,
            17 => Level::Exponentiation,
            18 => Level::Prefix,
            19 => Level::Postfix,
            20 => Level::New,
            21 => Level::Call,
            22 => Level::Member,
            _ => panic!("invalid Op.Level"),
        }
    }
}

#[derive(Copy, Clone)]
pub struct Op {
    pub text: &'static [u8],
    pub level: Level,
    pub is_keyword: bool,
}

impl Default for Op {
    fn default() -> Self {
        Op {
            text: b"",
            level: Level::Lowest,
            is_keyword: false,
        }
    }
}

impl Op {
    // PORT NOTE: Zig `init(triple: anytype)` took an anonymous tuple .{text, level, is_keyword}
    // and accessed .@"0"/.@"1"/.@"2". Flattened to positional params.
    pub const fn init(text: &'static [u8], level: Level, is_keyword: bool) -> Op {
        Op {
            text,
            level,
            is_keyword,
        }
    }

    // Zig std.json.Stringify hook → emits `self.text` as a JSON-encoded string
    // (quoted + escaped), e.g. `"+"` — not raw bytes.
    pub fn json_stringify<W: crate::JsonWriter>(
        &self,
        writer: &mut W,
    ) -> Result<(), bun_core::Error> {
        writer.write(self.text)
    }
}

// Zig: `pub const TableType: std.EnumArray(Op.Code, Op) = undefined;`
// This declared an `undefined` value (vestigial / used only for @TypeOf at callsites).
// Ported as a type alias since Rust statics cannot be uninitialized.
// TODO(port): verify no callsite reads TableType as a value.
pub type TableType = Table;

/// `.rodata` `[Op; Code::COUNT]` indexed by [`Code`] discriminant. Exposes the
/// Zig `std.EnumArray` surface (`getPtrConst`/`get`/`[]`) so downstream
/// callers don't see the raw array.
#[repr(transparent)]
pub struct Table(pub [Op; <Code as Enum>::LENGTH]);

impl Table {
    /// Zig: `Op.Table.getPtrConst(code) -> *const Op`.
    #[inline]
    pub fn get_ptr_const(&'static self, code: Code) -> &'static Op {
        &self.0[code as usize]
    }
    /// Zig: `Op.Table.get(code) -> Op`.
    #[inline]
    pub fn get(&self, code: Code) -> Op {
        self.0[code as usize]
    }
}

impl core::ops::Index<Code> for Table {
    type Output = Op;
    #[inline]
    fn index(&self, code: Code) -> &Op {
        &self.0[code as usize]
    }
}

// Built at const-eval time so it lives in `.rodata` with zero init code on the
// startup path (matches the Zig `comptime` labeled block).
pub static TABLE: Table = Table({
    const NIL: Op = Op::init(b"", Level::Lowest, false);
    let mut t = [NIL; <Code as Enum>::LENGTH];

    // Prefix
    t[Code::UnPos as usize] = Op::init(b"+", Level::Prefix, false);
    t[Code::UnNeg as usize] = Op::init(b"-", Level::Prefix, false);
    t[Code::UnCpl as usize] = Op::init(b"~", Level::Prefix, false);
    t[Code::UnNot as usize] = Op::init(b"!", Level::Prefix, false);
    t[Code::UnVoid as usize] = Op::init(b"void", Level::Prefix, true);
    t[Code::UnTypeof as usize] = Op::init(b"typeof", Level::Prefix, true);
    t[Code::UnDelete as usize] = Op::init(b"delete", Level::Prefix, true);

    // Prefix update
    t[Code::UnPreDec as usize] = Op::init(b"--", Level::Prefix, false);
    t[Code::UnPreInc as usize] = Op::init(b"++", Level::Prefix, false);

    // Postfix update
    t[Code::UnPostDec as usize] = Op::init(b"--", Level::Postfix, false);
    t[Code::UnPostInc as usize] = Op::init(b"++", Level::Postfix, false);

    // Left-associative
    t[Code::BinAdd as usize] = Op::init(b"+", Level::Add, false);
    t[Code::BinSub as usize] = Op::init(b"-", Level::Add, false);
    t[Code::BinMul as usize] = Op::init(b"*", Level::Multiply, false);
    t[Code::BinDiv as usize] = Op::init(b"/", Level::Multiply, false);
    t[Code::BinRem as usize] = Op::init(b"%", Level::Multiply, false);
    t[Code::BinPow as usize] = Op::init(b"**", Level::Exponentiation, false);
    t[Code::BinLt as usize] = Op::init(b"<", Level::Compare, false);
    t[Code::BinLe as usize] = Op::init(b"<=", Level::Compare, false);
    t[Code::BinGt as usize] = Op::init(b">", Level::Compare, false);
    t[Code::BinGe as usize] = Op::init(b">=", Level::Compare, false);
    t[Code::BinIn as usize] = Op::init(b"in", Level::Compare, true);
    t[Code::BinInstanceof as usize] = Op::init(b"instanceof", Level::Compare, true);
    t[Code::BinShl as usize] = Op::init(b"<<", Level::Shift, false);
    t[Code::BinShr as usize] = Op::init(b">>", Level::Shift, false);
    t[Code::BinUShr as usize] = Op::init(b">>>", Level::Shift, false);
    t[Code::BinLooseEq as usize] = Op::init(b"==", Level::Equals, false);
    t[Code::BinLooseNe as usize] = Op::init(b"!=", Level::Equals, false);
    t[Code::BinStrictEq as usize] = Op::init(b"===", Level::Equals, false);
    t[Code::BinStrictNe as usize] = Op::init(b"!==", Level::Equals, false);
    t[Code::BinNullishCoalescing as usize] = Op::init(b"??", Level::NullishCoalescing, false);
    t[Code::BinLogicalOr as usize] = Op::init(b"||", Level::LogicalOr, false);
    t[Code::BinLogicalAnd as usize] = Op::init(b"&&", Level::LogicalAnd, false);
    t[Code::BinBitwiseOr as usize] = Op::init(b"|", Level::BitwiseOr, false);
    t[Code::BinBitwiseAnd as usize] = Op::init(b"&", Level::BitwiseAnd, false);
    t[Code::BinBitwiseXor as usize] = Op::init(b"^", Level::BitwiseXor, false);

    // Non-associative
    t[Code::BinComma as usize] = Op::init(b",", Level::Comma, false);

    // Right-associative
    t[Code::BinAssign as usize] = Op::init(b"=", Level::Assign, false);
    t[Code::BinAddAssign as usize] = Op::init(b"+=", Level::Assign, false);
    t[Code::BinSubAssign as usize] = Op::init(b"-=", Level::Assign, false);
    t[Code::BinMulAssign as usize] = Op::init(b"*=", Level::Assign, false);
    t[Code::BinDivAssign as usize] = Op::init(b"/=", Level::Assign, false);
    t[Code::BinRemAssign as usize] = Op::init(b"%=", Level::Assign, false);
    t[Code::BinPowAssign as usize] = Op::init(b"**=", Level::Assign, false);
    t[Code::BinShlAssign as usize] = Op::init(b"<<=", Level::Assign, false);
    t[Code::BinShrAssign as usize] = Op::init(b">>=", Level::Assign, false);
    t[Code::BinUShrAssign as usize] = Op::init(b">>>=", Level::Assign, false);
    t[Code::BinBitwiseOrAssign as usize] = Op::init(b"|=", Level::Assign, false);
    t[Code::BinBitwiseAndAssign as usize] = Op::init(b"&=", Level::Assign, false);
    t[Code::BinBitwiseXorAssign as usize] = Op::init(b"^=", Level::Assign, false);
    t[Code::BinNullishCoalescingAssign as usize] = Op::init(b"??=", Level::Assign, false);
    t[Code::BinLogicalOrAssign as usize] = Op::init(b"||=", Level::Assign, false);
    t[Code::BinLogicalAndAssign as usize] = Op::init(b"&&=", Level::Assign, false);

    t
});

// ported from: src/js_parser/ast/Op.zig
