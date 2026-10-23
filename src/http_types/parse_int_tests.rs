//! Rows for `bun_core::fmt::parse_int`. They are here because `bun run rust:miri` runs this crate and not `bun_core`.

use bun_core::fmt::ParseIntError::{InvalidCharacter, Overflow};
use bun_core::fmt::{parse_decimal, parse_int, parse_unsigned};

const U64_MAX: &[u8] = b"18446744073709551615";
const PAST_U64: &[u8] = b"18446744073709551616";
const U128_MAX: &[u8] = b"340282366920938463463374607431768211455";
const PAST_U128: &[u8] = b"340282366920938463463374607431768211456";
const I128_MIN: &[u8] = b"-170141183460469231731687303715884105728";
const PAST_I128_MIN: &[u8] = b"-170141183460469231731687303715884105729";

#[test]
fn parse_int_at_the_u64_boundary() {
    assert_eq!(parse_int::<u64>(U64_MAX, 10), Ok(u64::MAX));
    assert_eq!(parse_int::<u64>(PAST_U64, 10), Err(Overflow));
    assert_eq!(parse_int::<i64>(U64_MAX, 10), Err(Overflow));
    assert_eq!(parse_int::<u128>(U64_MAX, 10), Ok((1 << 64) - 1));
    assert_eq!(parse_int::<u128>(PAST_U64, 10), Ok(1 << 64));
    assert_eq!(parse_int::<i128>(PAST_U64, 10), Ok(1 << 64));
    let negative = b"-18446744073709551616";
    assert_eq!(parse_int::<i128>(negative, 10), Ok(-(1 << 64)));
    assert_eq!(parse_int::<u128>(negative, 10), Err(Overflow));
    assert_eq!(parse_int::<i64>(negative, 10), Err(Overflow));
    assert_eq!(parse_unsigned::<u64>(U64_MAX, 10), Ok(u64::MAX));
    assert_eq!(parse_unsigned::<u64>(PAST_U64, 10), Err(Overflow));
    assert_eq!(parse_unsigned::<u128>(PAST_U64, 10), Ok(1 << 64));
    assert_eq!(parse_decimal::<u64>(U64_MAX), Some(u64::MAX));
    assert_eq!(parse_decimal::<u64>(PAST_U64), None);
    assert_eq!(parse_decimal::<i64>(b"9223372036854775807"), Some(i64::MAX));
    assert_eq!(parse_decimal::<i64>(b"9223372036854775808"), None);
    assert_eq!(
        parse_decimal::<i64>(b"-9223372036854775808"),
        Some(i64::MIN)
    );
    assert_eq!(parse_decimal::<i64>(b"-9223372036854775809"), None);
}

#[test]
fn parse_int_at_the_u128_boundary() {
    assert_eq!(parse_int::<u128>(U128_MAX, 10), Ok(u128::MAX));
    assert_eq!(parse_int::<u128>(PAST_U128, 10), Err(Overflow));
    assert_eq!(parse_int::<i128>(U128_MAX, 10), Err(Overflow));
    assert_eq!(parse_int::<i128>(I128_MIN, 10), Ok(i128::MIN));
    assert_eq!(parse_int::<i128>(&I128_MIN[1..], 10), Err(Overflow));
    assert_eq!(parse_int::<i128>(PAST_I128_MIN, 10), Err(Overflow));
    assert_eq!(parse_unsigned::<u128>(U128_MAX, 10), Ok(u128::MAX));
    assert_eq!(parse_unsigned::<u128>(PAST_U128, 10), Err(Overflow));
}

#[test]
fn parse_int_at_the_u64_boundary_in_other_radixes() {
    assert_eq!(parse_int::<u64>(&[b'f'; 16], 16), Ok(u64::MAX));
    assert_eq!(parse_int::<u64>(&[b'F'; 16], 16), Ok(u64::MAX));
    assert_eq!(parse_int::<u64>(&[b'f'; 17], 16), Err(Overflow));
    assert_eq!(parse_int::<u128>(&[b'f'; 17], 16), Ok((1 << 68) - 1));
    let octal = b"1777777777777777777777";
    let past_octal = b"2000000000000000000000";
    assert_eq!(parse_int::<u64>(octal, 8), Ok(u64::MAX));
    assert_eq!(parse_int::<u64>(past_octal, 8), Err(Overflow));
    assert_eq!(parse_int::<u128>(past_octal, 8), Ok(1 << 64));
    assert_eq!(parse_int::<u64>(&[b'1'; 64], 2), Ok(u64::MAX));
    assert_eq!(parse_int::<u64>(&[b'1'; 65], 2), Err(Overflow));
    assert_eq!(parse_int::<u128>(&[b'1'; 65], 2), Ok((1 << 65) - 1));
    assert_eq!(parse_int::<u64>(b"3w5e11264sgsf", 36), Ok(u64::MAX));
    assert_eq!(parse_int::<u64>(b"3W5E11264SGSG", 36), Err(Overflow));
    assert_eq!(parse_int::<u128>(b"3w5e11264sgsg", 36), Ok(1 << 64));
    assert_eq!(parse_int::<u16>(b"zz", 36), Ok(1295));
    let hex = b"0xffffffffffffffff";
    let past_hex = b"-0X10000000000000000";
    assert_eq!(parse_int::<u64>(hex, 0), Ok(u64::MAX));
    assert_eq!(parse_int::<i128>(past_hex, 0), Ok(-(1 << 64)));
    assert_eq!(parse_unsigned::<u64>(b"0b11", 0), Ok(3));
    assert_eq!(parse_unsigned::<u64>(b"0B11", 0), Ok(3));
    assert_eq!(parse_unsigned::<u64>(b"0o17", 0), Ok(15));
    assert_eq!(parse_unsigned::<u64>(b"0O17", 0), Ok(15));
    assert_eq!(parse_unsigned::<u64>(b"017", 0), Ok(17));
    assert_eq!(parse_unsigned::<u64>(b"0x", 0), Err(InvalidCharacter));
    assert_eq!(parse_unsigned::<u64>(b"0x1", 10), Err(InvalidCharacter));
    assert_eq!(parse_int::<u8>(b"2", 2), Err(InvalidCharacter));
    assert_eq!(parse_int::<u8>(b"g", 16), Err(InvalidCharacter));
}

#[test]
fn parse_int_signs_and_separators() {
    assert_eq!(parse_int::<i32>(b"+7", 10), Ok(7));
    assert_eq!(parse_int::<i32>(b"-7", 10), Ok(-7));
    assert_eq!(parse_int::<u32>(b"-0", 10), Ok(0));
    assert_eq!(parse_int::<u32>(b"-1", 10), Err(Overflow));
    assert_eq!(parse_int::<i32>(b"2147483647", 10), Ok(i32::MAX));
    assert_eq!(parse_int::<i32>(b"2147483648", 10), Err(Overflow));
    assert_eq!(parse_int::<i32>(b"-2147483648", 10), Ok(i32::MIN));
    assert_eq!(parse_int::<i32>(b"-2147483649", 10), Err(Overflow));
    assert_eq!(parse_int::<u8>(b"255", 10), Ok(255));
    assert_eq!(parse_int::<u8>(b"256", 10), Err(Overflow));
    for no_number in [&b""[..], b"+", b"-", b"--1", b"+-1", b" 1", b"1 "] {
        assert_eq!(parse_int::<i64>(no_number, 10), Err(InvalidCharacter));
    }
    for signed in [&b""[..], b"+1", b"-0", b"-1"] {
        assert_eq!(parse_unsigned::<u64>(signed, 10), Err(InvalidCharacter));
    }
    assert_eq!(parse_int::<u32>(b"1_0", 10), Ok(10));
    assert_eq!(parse_int::<u32>(b"1__0", 10), Ok(10));
    assert_eq!(parse_int::<i32>(b"-1_000_000", 10), Ok(-1_000_000));
    assert_eq!(parse_unsigned::<u32>(b"0xf_f", 0), Ok(255));
    assert_eq!(parse_unsigned::<u32>(b"0x_f", 0), Err(InvalidCharacter));
    for misplaced in [&b"_"[..], b"_1", b"1_", b"_1_", b"-_1", b"-1_"] {
        assert_eq!(parse_int::<i32>(misplaced, 10), Err(InvalidCharacter));
        assert_eq!(parse_unsigned::<u32>(misplaced, 10), Err(InvalidCharacter));
    }
    let mut padded = [b'0'; 41];
    padded[40] = b'1';
    assert_eq!(parse_int::<u8>(&padded, 10), Ok(1));
    assert_eq!(parse_unsigned::<u64>(&padded, 10), Ok(1));
}

// The order on main since the Rust port (#30412): an invalid byte wins until the value leaves a `u128`.
#[test]
fn parse_int_error_precedence() {
    assert_eq!(parse_int::<u8>(b"999x", 10), Err(InvalidCharacter));
    let mut past_u64 = [b'x'; 23];
    past_u64[..20].copy_from_slice(PAST_U64);
    assert_eq!(parse_int::<u64>(&past_u64[..21], 10), Err(InvalidCharacter));
    past_u64[20] = b'_';
    assert_eq!(parse_int::<u64>(&past_u64[..21], 10), Err(InvalidCharacter));
    past_u64[21] = b'0';
    assert_eq!(parse_int::<u64>(&past_u64[..22], 10), Err(Overflow));
    assert_eq!(parse_int::<u128>(&past_u64[..22], 10), Ok(10 << 64));
    assert_eq!(parse_int::<u128>(&past_u64, 10), Err(InvalidCharacter));
    let separated = b"1844674407370955161_6";
    assert_eq!(parse_unsigned::<u128>(separated, 10), Ok(1 << 64));
    assert_eq!(parse_unsigned::<u64>(separated, 10), Err(Overflow));
    let mut past_u128 = [b'x'; 41];
    past_u128[..39].copy_from_slice(U128_MAX);
    assert_eq!(
        parse_int::<u128>(&past_u128[..40], 10),
        Err(InvalidCharacter)
    );
    assert_eq!(
        parse_unsigned::<u8>(&past_u128[..40], 10),
        Err(InvalidCharacter)
    );
    past_u128[39] = b'0';
    assert_eq!(parse_int::<u128>(&past_u128, 10), Err(Overflow));
    assert_eq!(parse_unsigned::<u8>(&past_u128, 10), Err(Overflow));
    past_u128[40] = b'_';
    assert_eq!(parse_int::<u128>(&past_u128, 10), Err(InvalidCharacter));
    assert_eq!(parse_unsigned::<u8>(&past_u128, 10), Err(InvalidCharacter));
}
