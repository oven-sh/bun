use std::sync::LazyLock;

use enum_map::{enum_map, Enum, EnumMap};
use strum::IntoStaticStr;

use bun_js_parser::ast::AssignTarget;

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
    // TODO(port): json serialization protocol — Zig std.json.Stringify hook.
    // Writer is `anytype` calling `.write(str)`; mapped to a generic byte writer.
    pub fn json_stringify<W: bun_io::Write>(self, writer: &mut W) -> Result<(), bun_core::Error> {
        writer.write(<&'static str>::from(self).as_bytes())?;
        Ok(())
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

    pub fn binary_assign_target(code: Code) -> AssignTarget {
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
        debug_assert!(n <= Level::Member as u8);
        // SAFETY: Level is #[repr(u8)] and n is range-checked above (debug);
        // callers only pass values derived from valid Level discriminants ±1.
        unsafe { core::mem::transmute::<u8, Level>(n) }
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
        Op { text: b"", level: Level::Lowest, is_keyword: false }
    }
}

impl Op {
    // PORT NOTE: Zig `init(triple: anytype)` took an anonymous tuple .{text, level, is_keyword}
    // and accessed .@"0"/.@"1"/.@"2". Flattened to positional params.
    pub const fn init(text: &'static [u8], level: Level, is_keyword: bool) -> Op {
        Op { text, level, is_keyword }
    }

    // TODO(port): json serialization protocol — Zig std.json.Stringify hook.
    pub fn json_stringify<W: bun_io::Write>(&self, writer: &mut W) -> Result<(), bun_core::Error> {
        writer.write(self.text)?;
        Ok(())
    }
}

// Zig: `pub const TableType: std.EnumArray(Op.Code, Op) = undefined;`
// This declared an `undefined` value (vestigial / used only for @TypeOf at callsites).
// Ported as a type alias since Rust statics cannot be uninitialized.
// TODO(port): verify no callsite reads TableType as a value.
pub type TableType = EnumMap<Code, Op>;

// PERF(port): Zig built this at comptime via labeled block; enum_map! is not
// const-evaluable so we use LazyLock — profile in Phase B (likely cold).
pub static TABLE: LazyLock<EnumMap<Code, Op>> = LazyLock::new(|| {
    enum_map! {
        // Prefix
        Code::UnPos    => Op::init(b"+", Level::Prefix, false),
        Code::UnNeg    => Op::init(b"-", Level::Prefix, false),
        Code::UnCpl    => Op::init(b"~", Level::Prefix, false),
        Code::UnNot    => Op::init(b"!", Level::Prefix, false),
        Code::UnVoid   => Op::init(b"void", Level::Prefix, true),
        Code::UnTypeof => Op::init(b"typeof", Level::Prefix, true),
        Code::UnDelete => Op::init(b"delete", Level::Prefix, true),

        // Prefix update
        Code::UnPreDec => Op::init(b"--", Level::Prefix, false),
        Code::UnPreInc => Op::init(b"++", Level::Prefix, false),

        // Postfix update
        Code::UnPostDec => Op::init(b"--", Level::Postfix, false),
        Code::UnPostInc => Op::init(b"++", Level::Postfix, false),

        // Left-associative
        Code::BinAdd               => Op::init(b"+", Level::Add, false),
        Code::BinSub               => Op::init(b"-", Level::Add, false),
        Code::BinMul               => Op::init(b"*", Level::Multiply, false),
        Code::BinDiv               => Op::init(b"/", Level::Multiply, false),
        Code::BinRem               => Op::init(b"%", Level::Multiply, false),
        Code::BinPow               => Op::init(b"**", Level::Exponentiation, false),
        Code::BinLt                => Op::init(b"<", Level::Compare, false),
        Code::BinLe                => Op::init(b"<=", Level::Compare, false),
        Code::BinGt                => Op::init(b">", Level::Compare, false),
        Code::BinGe                => Op::init(b">=", Level::Compare, false),
        Code::BinIn                => Op::init(b"in", Level::Compare, true),
        Code::BinInstanceof        => Op::init(b"instanceof", Level::Compare, true),
        Code::BinShl               => Op::init(b"<<", Level::Shift, false),
        Code::BinShr               => Op::init(b">>", Level::Shift, false),
        Code::BinUShr              => Op::init(b">>>", Level::Shift, false),
        Code::BinLooseEq           => Op::init(b"==", Level::Equals, false),
        Code::BinLooseNe           => Op::init(b"!=", Level::Equals, false),
        Code::BinStrictEq          => Op::init(b"===", Level::Equals, false),
        Code::BinStrictNe          => Op::init(b"!==", Level::Equals, false),
        Code::BinNullishCoalescing => Op::init(b"??", Level::NullishCoalescing, false),
        Code::BinLogicalOr         => Op::init(b"||", Level::LogicalOr, false),
        Code::BinLogicalAnd        => Op::init(b"&&", Level::LogicalAnd, false),
        Code::BinBitwiseOr         => Op::init(b"|", Level::BitwiseOr, false),
        Code::BinBitwiseAnd        => Op::init(b"&", Level::BitwiseAnd, false),
        Code::BinBitwiseXor        => Op::init(b"^", Level::BitwiseXor, false),

        // Non-associative
        Code::BinComma => Op::init(b",", Level::Comma, false),

        // Right-associative
        Code::BinAssign                  => Op::init(b"=", Level::Assign, false),
        Code::BinAddAssign               => Op::init(b"+=", Level::Assign, false),
        Code::BinSubAssign               => Op::init(b"-=", Level::Assign, false),
        Code::BinMulAssign               => Op::init(b"*=", Level::Assign, false),
        Code::BinDivAssign               => Op::init(b"/=", Level::Assign, false),
        Code::BinRemAssign               => Op::init(b"%=", Level::Assign, false),
        Code::BinPowAssign               => Op::init(b"**=", Level::Assign, false),
        Code::BinShlAssign               => Op::init(b"<<=", Level::Assign, false),
        Code::BinShrAssign               => Op::init(b">>=", Level::Assign, false),
        Code::BinUShrAssign              => Op::init(b">>>=", Level::Assign, false),
        Code::BinBitwiseOrAssign         => Op::init(b"|=", Level::Assign, false),
        Code::BinBitwiseAndAssign        => Op::init(b"&=", Level::Assign, false),
        Code::BinBitwiseXorAssign        => Op::init(b"^=", Level::Assign, false),
        Code::BinNullishCoalescingAssign => Op::init(b"??=", Level::Assign, false),
        Code::BinLogicalOrAssign         => Op::init(b"||=", Level::Assign, false),
        Code::BinLogicalAndAssign        => Op::init(b"&&=", Level::Assign, false),
    }
});

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/Op.zig (291 lines)
//   confidence: high
//   todos:      3
//   notes:      TABLE moved from comptime to LazyLock; TableType ported as type alias (was `undefined` value); json_stringify writer trait may need adjustment
// ──────────────────────────────────────────────────────────────────────────
