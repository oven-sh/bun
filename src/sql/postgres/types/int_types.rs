#![allow(non_camel_case_types)]

pub type int4 = u32;
pub type PostgresInt32 = int4;
pub type int8 = i64;
pub type PostgresInt64 = int8;
pub type short = u16;
pub type PostgresShort = u16;

pub fn int32<T>(value: T) -> [u8; 4]
where
    int4: TryFrom<T>,
{
    // @intCast → checked narrowing; @byteSwap → .swap_bytes(); @bitCast to [4]u8 → .to_ne_bytes()
    let v: int4 = int4::try_from(value).ok().expect("@intCast");
    v.swap_bytes().to_ne_bytes()
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sql/postgres/types/int_types.zig (10 lines)
//   confidence: high
//   todos:      0
//   notes:      type aliases kept lowercase (PostgreSQL wire-protocol names); int32() bounds on TryFrom<T> to model @intCast over anytype
// ──────────────────────────────────────────────────────────────────────────
