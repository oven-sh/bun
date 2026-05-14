use crate::css_parser as css;
use crate::css_parser::{CssResult as Result, Maybe, PrintErr, Printer, Token};
use crate::values::angle::Angle;
use crate::values::calc::Calc;
use crate::values::number::{CSSNumber, CSSNumberFns};

/// A CSS [`<time>`](https://www.w3.org/TR/css-values-4/#time) value, in either
/// seconds or milliseconds.
///
/// Time values may be explicit or computed by `calc()`, but are always stored and serialized
/// as their computed value.
#[repr(u8)]
#[derive(
    Clone,
    Copy,
    PartialEq,
    Debug,
    crate::generics::CssEql,
    crate::generics::CssHash,
    crate::generics::DeepClone,
)]
pub enum Time {
    /// A time in seconds.
    Seconds(CSSNumber) = 1,
    /// A time in milliseconds.
    Milliseconds(CSSNumber) = 2,
}

// Mirrors Zig's nested `Tag = enum(u8) { seconds = 1, milliseconds = 2 }`.
const TAG_SECONDS: u16 = 1;
const TAG_MILLISECONDS: u16 = 2;

impl Time {
    #[inline]
    fn tag(&self) -> u16 {
        match self {
            Time::Seconds(_) => TAG_SECONDS,
            Time::Milliseconds(_) => TAG_MILLISECONDS,
        }
    }

    // css.implementDeepClone / css.implementEql / css.implementHash — provided
    // by `#[derive(DeepClone, CssEql, CssHash)]` above (POD f32 payload).
    // Kept as an inherent assoc fn for `protocol::CalcValue` callers that
    // forward via UFCS (`Time::eql(a, b)`) — does not conflict with the
    // derived trait method (that one has a `&self` receiver).
    #[inline]
    pub fn eql(lhs: &Self, rhs: &Self) -> bool {
        lhs == rhs
    }

    pub fn parse(input: &mut css::Parser) -> Result<Time> {
        match input.try_parse(Calc::<Time>::parse) {
            Ok(vv) => match vv {
                Calc::Value(v) => {
                    let ret: Time = *v;
                    // redundant allocation
                    // Zig: vvv.deinit(input.arena()) — Drop handles this; line deleted.
                    return Ok(ret);
                }
                // Time is always compatible, so they will always compute to a value.
                _ => return Err(input.new_error_for_next_token()),
            },
            Err(_) => {}
        }

        let location = input.current_source_location();
        let token = input.next()?.clone();
        match &token {
            Token::Dimension(dim) => {
                // TODO(port): Zig fn name has a typo (`ASCIII`); verify exact bun_str symbol in Phase B.
                if bun_core::strings::eql_case_insensitive_ascii_check_length(b"s", dim.unit) {
                    Ok(Time::Seconds(dim.num.value))
                } else if bun_core::strings::eql_case_insensitive_ascii_check_length(
                    b"ms", dim.unit,
                ) {
                    Ok(Time::Milliseconds(dim.num.value))
                } else {
                    Err(location.new_unexpected_token_error(Token::Ident(dim.unit)))
                }
            }
            _ => Err(location.new_unexpected_token_error(token)),
        }
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        // 0.1s is shorter than 100ms
        // anything smaller is longer
        match *self {
            Time::Seconds(s) => {
                if s > 0.0 && s < 0.1 {
                    CSSNumberFns::to_css(&(s * 1000.0), dest)?;
                    dest.write_str("ms")?;
                } else {
                    CSSNumberFns::to_css(&s, dest)?;
                    dest.write_str("s")?;
                }
            }
            Time::Milliseconds(ms) => {
                if ms == 0.0 || ms >= 100.0 {
                    CSSNumberFns::to_css(&(ms / 1000.0), dest)?;
                    dest.write_str("s")?;
                } else {
                    CSSNumberFns::to_css(&ms, dest)?;
                    dest.write_str("ms")?;
                }
            }
        }
        Ok(())
    }

    pub fn is_zero(&self) -> bool {
        match *self {
            Time::Seconds(s) => s == 0.0,
            Time::Milliseconds(ms) => ms == 0.0,
        }
    }

    /// Returns the time in milliseconds.
    pub fn to_ms(&self) -> CSSNumber {
        match *self {
            Time::Seconds(v) => v * 1000.0,
            Time::Milliseconds(v) => v,
        }
    }

    pub fn try_from_token(token: &Token) -> Maybe<Time, ()> {
        match token {
            Token::Dimension(dim) => crate::match_ignore_ascii_case! { dim.unit, {
                b"s" => Ok(Time::Seconds(dim.num.value)),
                b"ms" => Ok(Time::Milliseconds(dim.num.value)),
                _ => Err(()),
            }},
            _ => Err(()),
        }
    }

    pub fn try_from_angle(_: Angle) -> Option<Self> {
        None
    }

    pub fn mul_f32(self, other: f32) -> Time {
        // Zig arena param dropped (unused).
        match self {
            Time::Seconds(s) => Time::Seconds(s * other),
            Time::Milliseconds(ms) => Time::Milliseconds(ms * other),
        }
    }

    pub fn add_internal(self, other: Time) -> Time {
        // Zig arena param dropped (forwarded but ultimately unused).
        self.add(other)
    }

    pub fn into_calc(self) -> Calc<Time> {
        // PERF(port): was arena alloc (bun.create) — Calc<V>::Value now owns Box<V>.
        Calc::Value(Box::new(self))
    }

    pub fn add(self, other: Self) -> Time {
        // Zig arena param dropped (unused).
        // PORT NOTE: Zig passes `void` ctx + free fn; Rust closure captures nothing.
        self.op(&other, |a, b| a + b)
    }

    pub fn partial_cmp(&self, other: &Time) -> Option<core::cmp::Ordering> {
        crate::generic::partial_cmp_f32(&self.to_ms(), &other.to_ms())
    }

    pub fn map(&self, map_fn: impl Fn(f32) -> f32) -> Time {
        // PERF(port): was comptime fn-pointer monomorphization — profile in Phase B.
        match *self {
            Time::Seconds(s) => Time::Seconds(map_fn(s)),
            Time::Milliseconds(ms) => Time::Milliseconds(map_fn(ms)),
        }
    }

    pub fn sign(&self) -> f32 {
        match *self {
            Time::Seconds(v) => CSSNumberFns::sign(&v),
            Time::Milliseconds(v) => CSSNumberFns::sign(&v),
        }
    }

    pub fn op(&self, other: &Time, op_fn: impl Fn(f32, f32) -> f32) -> Time {
        // PORT NOTE: Zig uses `ctx: anytype` + comptime fn-pointer (its closure idiom).
        // Rust closures capture ctx directly, so the `ctx` param is dropped.
        // PORT NOTE: reshaped bit-packed `switch_val` into an exhaustive tuple match;
        // semantics are identical, `unreachable` arm is unnecessary.
        let _ = (self.tag(), TAG_SECONDS, TAG_MILLISECONDS); // keep tag consts referenced
        match (*self, *other) {
            (Time::Seconds(a), Time::Seconds(b)) => Time::Seconds(op_fn(a, b)),
            (Time::Milliseconds(a), Time::Milliseconds(b)) => Time::Milliseconds(op_fn(a, b)),
            (Time::Seconds(a), Time::Milliseconds(b)) => Time::Seconds(op_fn(a, b / 1000.0)),
            (Time::Milliseconds(a), Time::Seconds(b)) => Time::Milliseconds(op_fn(a, b * 1000.0)),
        }
    }

    pub fn op_to<R>(&self, other: &Time, op_fn: impl Fn(f32, f32) -> R) -> R {
        // PORT NOTE: see `op` — ctx param folded into closure; bit-packed switch reshaped.
        match (*self, *other) {
            (Time::Seconds(a), Time::Seconds(b)) => op_fn(a, b),
            (Time::Milliseconds(a), Time::Milliseconds(b)) => op_fn(a, b),
            (Time::Seconds(a), Time::Milliseconds(b)) => op_fn(a, b / 1000.0),
            (Time::Milliseconds(a), Time::Seconds(b)) => op_fn(a, b * 1000.0),
        }
    }
}

// ported from: src/css/values/time.zig
