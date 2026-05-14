use crate::css_parser as css;
use crate::css_parser::{CssResult, PrintErr, Printer};
use crate::values::angle::Angle;
use crate::values::length::{Length, LengthValue};
use crate::values::number::{CSSNumber, CSSNumberFns};
use crate::values::percentage::{DimensionPercentage, Percentage};
use crate::values::protocol;
use crate::values::time::Time;
// Bring the numeric-protocol traits into scope so their methods resolve via the
// `CalcValue` supertrait bounds inside `impl<V: CalcValue> Calc<V>`.
use crate::values::protocol::{
    IsCompatible, MulF32, Parse, ToCss, TryFromAngle, TryMap, TryOp, TryOpTo, TrySign,
};

use core::cmp::Ordering;

// TODO(port): `needsDeinit` / `needsDeepclone` were comptime type predicates used to gate
// per-variant cleanup/clone in Zig. In Rust, `Drop` on `Box<V>` and `V: Clone` subsume
// these. Kept as stubs for parity; Phase B may delete.
pub const fn needs_deinit<V>() -> bool {
    // TODO(port): comptime type switch — not expressible in Rust; subsumed by Drop.
    true
}

pub const fn needs_deepclone<V>() -> bool {
    // TODO(port): comptime type switch — not expressible in Rust; subsumed by Clone.
    true
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
enum Tag {
    /// A literal value.
    Value = 1,
    /// A literal number.
    Number = 2,
    /// A sum of two calc expressions.
    Sum = 4,
    /// A product of a number and another calc expression.
    Product = 8,
    /// A math function, such as `calc()`, `min()`, or `max()`.
    Function = 16,
}

#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr, strum::EnumString)]
#[strum(serialize_all = "lowercase")]
pub enum CalcUnit {
    Abs,
    Acos,
    Asin,
    Atan,
    Atan2,
    Calc,
    Clamp,
    Cos,
    Exp,
    Hypot,
    Log,
    Max,
    Min,
    Mod,
    Pow,
    Rem,
    Round,
    Sign,
    Sin,
    Sqrt,
    Tan,
}

impl CalcUnit {
    /// Zig: `bun.ComptimeEnumMap(CalcUnit).getAnyCase(f)`
    // TODO(port): phf custom hasher — case-insensitive lookup over &[u8].
    pub fn get_any_case(f: &[u8]) -> Option<Self> {
        // PERF(port): Zig used a comptime perfect hash; this is a linear match on a
        // stack-lowercased byte slice. Phase B: phf_map! over &[u8].
        // §Strings: source bytes are &[u8], never &str/String — no from_utf8/to_ascii_lowercase().
        let (buf, len) = bun_core::strings::ascii_lowercase_buf::<5>(f)?;
        match &buf[..len] {
            b"abs" => Some(Self::Abs),
            b"acos" => Some(Self::Acos),
            b"asin" => Some(Self::Asin),
            b"atan" => Some(Self::Atan),
            b"atan2" => Some(Self::Atan2),
            b"calc" => Some(Self::Calc),
            b"clamp" => Some(Self::Clamp),
            b"cos" => Some(Self::Cos),
            b"exp" => Some(Self::Exp),
            b"hypot" => Some(Self::Hypot),
            b"log" => Some(Self::Log),
            b"max" => Some(Self::Max),
            b"min" => Some(Self::Min),
            b"mod" => Some(Self::Mod),
            b"pow" => Some(Self::Pow),
            b"rem" => Some(Self::Rem),
            b"round" => Some(Self::Round),
            b"sign" => Some(Self::Sign),
            b"sin" => Some(Self::Sin),
            b"sqrt" => Some(Self::Sqrt),
            b"tan" => Some(Self::Tan),
            _ => None,
        }
    }
}

/// A mathematical expression used within the `calc()` function.
///
/// This type supports generic value types. Values such as `Length`, `Percentage`,
/// `Time`, and `Angle` support `calc()` expressions.
pub enum Calc<V> {
    /// A literal value.
    /// PERF: this pointer feels unnecessary if V is small
    Value(Box<V>),
    /// A literal number.
    Number(CSSNumber),
    /// A sum of two calc expressions.
    Sum {
        left: Box<Calc<V>>,
        right: Box<Calc<V>>,
    },
    /// A product of a number and another calc expression.
    Product {
        number: CSSNumber,
        expression: Box<Calc<V>>,
    },
    /// A math function, such as `calc()`, `min()`, or `max()`.
    Function(Box<MathFunction<V>>),
}

// ───────────────────────────── CalcValue trait ─────────────────────────────
// Replaces the Zig `switch (V)` / `@hasDecl(V, ...)` comptime-type dispatch.
// Every type that can appear inside `Calc<V>` implements this.
//
// The numeric protocol (`mul_f32`/`try_sign`/`try_map`/`try_op`/`try_op_to`/
// `partial_cmp`/`try_from_angle`/`parse`/`to_css`/`is_compatible`) lives in
// `crate::values::protocol` (re-exported from `crate::generics`); `CalcValue`
// pulls it in as supertraits so each concrete impl block only carries the
// calc-specific hooks below.

pub trait CalcValue:
    Sized
    + Clone
    + protocol::MulF32
    + protocol::TrySign
    + protocol::TryMap
    + protocol::TryOp
    + protocol::TryOpTo
    + protocol::PartialCmp
    + protocol::TryFromAngle
    + protocol::Parse
    + protocol::ToCss
    + protocol::IsCompatible
{
    fn add_internal(self, rhs: Self) -> Self;
    /// Wrap a value as a `Calc<Self>` (Zig: `intoCalc`).
    fn into_calc(self) -> Calc<Self>;
    /// Convert a `Calc<Self>` into `Self` if representable (Zig: `intoValue`).
    fn from_calc(c: Calc<Self>, input: &mut css::Parser) -> CssResult<Self>;
    fn eql(&self, other: &Self) -> bool;
}

impl<V: Clone> Clone for Calc<V> {
    fn clone(&self) -> Self {
        self.deep_clone()
    }
}

// Structural equality decoupled from `CalcValue` so `derive(PartialEq)` on
// `Length` / `DimensionPercentage<D>` consumers can compare through
// `Box<Calc<V>>` without pulling in the full behavior bound. `Calc::eql`
// (below) keeps its `V: CalcValue` bound for callers that already have it.
impl<V: PartialEq + Clone> PartialEq for Calc<V> {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Calc::Value(a), Calc::Value(b)) => **a == **b,
            (Calc::Number(a), Calc::Number(b)) => a == b,
            (
                Calc::Sum {
                    left: al,
                    right: ar,
                },
                Calc::Sum {
                    left: bl,
                    right: br,
                },
            ) => **al == **bl && **ar == **br,
            (
                Calc::Product {
                    number: an,
                    expression: ae,
                },
                Calc::Product {
                    number: bn,
                    expression: be,
                },
            ) => an == bn && **ae == **be,
            (Calc::Function(a), Calc::Function(b)) => **a == **b,
            _ => false,
        }
    }
}

impl<V> Calc<V> {
    pub fn deep_clone(&self) -> Self
    where
        V: Clone,
    {
        match self {
            Calc::Value(v) => {
                // Zig: if (needs_deepclone) v.deepClone(arena) else v.*
                // Rust: V: Clone covers both — V's Clone impl is the deep clone.
                Calc::Value(Box::new((**v).clone()))
            }
            Calc::Number(n) => Calc::Number(*n),
            Calc::Sum { left, right } => Calc::Sum {
                left: Box::new(left.deep_clone()),
                right: Box::new(right.deep_clone()),
            },
            Calc::Product { number, expression } => Calc::Product {
                number: *number,
                expression: Box::new(expression.deep_clone()),
            },
            Calc::Function(function) => Calc::Function(Box::new(function.deep_clone())),
        }
    }

    pub fn deep_clone_boxed(&self) -> Box<Self>
    where
        V: Clone,
    {
        Box::new(self.deep_clone())
    }

    // Zig `deinit` only freed owned Box fields → handled by Drop on Box<V>/Box<Calc<V>>/
    // Box<MathFunction<V>>. No explicit Drop impl needed.

    pub fn eql(&self, other: &Self) -> bool
    where
        V: CalcValue,
    {
        match (self, other) {
            (Calc::Value(a), Calc::Value(b)) => a.eql(b),
            (Calc::Number(a), Calc::Number(b)) => *a == *b,
            (
                Calc::Sum {
                    left: al,
                    right: ar,
                },
                Calc::Sum {
                    left: bl,
                    right: br,
                },
            ) => al.eql(bl) && ar.eql(br),
            (
                Calc::Product {
                    number: an,
                    expression: ae,
                },
                Calc::Product {
                    number: bn,
                    expression: be,
                },
            ) => an == bn && ae.eql(be),
            (Calc::Function(a), Calc::Function(b)) => a.eql(b),
            _ => false,
        }
    }
}

// `PartialEq for Calc<V>` is provided above with the looser `V: PartialEq +
// Clone` bound so structural equality is available without `CalcValue`.

impl<V: CalcValue> Calc<V> {
    fn mul_value_f32(lhs: V, rhs: f32) -> V {
        // Zig: `f32 => lhs * rhs, else => lhs.mulF32(...)` — folded into trait.
        lhs.mul_f32(rhs)
    }

    // TODO: addValueOwned
    pub fn add_value(lhs: V, rhs: V) -> V {
        // Zig: `f32 => lhs + rhs, else => lhs.addInternal(...)` — folded into trait.
        lhs.add_internal(rhs)
    }

    // TODO: intoValueOwned
    pub fn into_value(self, input: &mut css::Parser) -> CssResult<V> {
        // Zig comptime type switch on V → trait method `V::from_calc`.
        V::from_calc(self, input)
    }

    pub fn into_calc(val: V) -> Self {
        // Zig: `f32 => .{ .value = box(val) }, else => val.intoCalc()` — folded into trait.
        val.into_calc()
    }

    // TODO: change to addOwned()
    pub fn add(self, rhs: Self, input: &mut css::Parser) -> CssResult<Self> {
        if let (Calc::Value(_), Calc::Value(_)) = (&self, &rhs) {
            // PERF: we can reuse the allocation here
            // PORT NOTE: reshaped for borrowck — clone out of boxes then drop originals.
            let (a, b) = match (self, rhs) {
                (Calc::Value(a), Calc::Value(b)) => (*a, *b),
                _ => unreachable!(),
            };
            return Ok(Self::into_calc(Self::add_value(a, b)));
        }
        if let (Calc::Number(a), Calc::Number(b)) = (&self, &rhs) {
            return Ok(Calc::Number(a + b));
        }
        if matches!(self, Calc::Value(_)) {
            // PERF: we can reuse the allocation here
            let a = match self {
                Calc::Value(a) => *a,
                _ => unreachable!(),
            };
            let rhs_value = rhs.into_value(input)?;
            return Ok(Self::into_calc(Self::add_value(a, rhs_value)));
        }
        if matches!(rhs, Calc::Value(_)) {
            // PERF: we can reuse the allocation here
            let b = match rhs {
                Calc::Value(b) => *b,
                _ => unreachable!(),
            };
            let this_value = self.into_value(input)?;
            return Ok(Self::into_calc(Self::add_value(this_value, b)));
        }
        if matches!(self, Calc::Function(_)) || matches!(rhs, Calc::Function(_)) {
            return Ok(Calc::Sum {
                left: Box::new(self),
                right: Box::new(rhs),
            });
        }
        let this_value = self.into_value(input)?;
        let rhs_value = rhs.into_value(input)?;
        Ok(Self::into_calc(Self::add_value(this_value, rhs_value)))
    }

    // TODO: users of this and `parseWith` don't need the pointer and often throwaway heap allocated values immediately
    // use temp arena or something?
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        fn parse_with_fn<V>(_: (), _: &[u8]) -> Option<Calc<V>> {
            None
        }
        Self::parse_with(input, (), parse_with_fn::<V>)
    }

    pub fn parse_with<C: Copy, F: Fn(C, &[u8]) -> Option<Self> + Copy>(
        input: &mut css::Parser,
        ctx: C,
        parse_ident: F,
    ) -> CssResult<Self> {
        let location = input.current_source_location();
        // PORT NOTE: clone the token before reborrowing `input` so the function
        // name slice is owned by the cloned `Token` (whose payload already
        // carries the Phase-A arena lifetime) instead of being laundered to
        // `'static` here.
        let tok = input.next()?.clone();
        let unit = match tok {
            css::Token::Function(f) => match CalcUnit::get_any_case(f) {
                Some(u) => u,
                None => {
                    return Err(location.new_unexpected_token_error(css::Token::Ident(f)));
                }
            },
            other => return Err(location.new_unexpected_token_error(other)),
        };

        // PORT NOTE: Zig used explicit `Closure` structs because Zig lacks closures.
        // Rust closures capture `ctx` + `parse_ident` directly.
        match unit {
            CalcUnit::Calc => {
                let calc = input.parse_nested_block(|i| Self::parse_sum(i, ctx, parse_ident))?;
                if matches!(calc, Calc::Value(_) | Calc::Number(_)) {
                    return Ok(calc);
                }
                Ok(Calc::Function(Box::new(MathFunction::Calc(calc))))
            }
            CalcUnit::Min => {
                let mut reduced = input.parse_nested_block(|i| {
                    i.parse_comma_separated(|i| Self::parse_sum(i, ctx, parse_ident))
                })?;
                // PERF(alloc): i don't like this additional allocation
                // can we use stack fallback here if the common case is that there will be 1 argument?
                Self::reduce_args(&mut reduced, Ordering::Less);
                if reduced.len() == 1 {
                    return Ok(reduced.swap_remove(0));
                }
                Ok(Calc::Function(Box::new(MathFunction::Min(reduced))))
            }
            CalcUnit::Max => {
                let mut reduced = input.parse_nested_block(|i| {
                    i.parse_comma_separated(|i| Self::parse_sum(i, ctx, parse_ident))
                })?;
                // PERF: i don't like this additional allocation
                Self::reduce_args(&mut reduced, Ordering::Greater);
                if reduced.len() == 1 {
                    return Ok(reduced.remove(0));
                }
                Ok(Calc::Function(Box::new(MathFunction::Max(reduced))))
            }
            CalcUnit::Clamp => {
                let (mut min, mut center, mut max) = input.parse_nested_block(|i| {
                    let min = Self::parse_sum(i, ctx, parse_ident)?;
                    i.expect_comma()?;
                    let center = Self::parse_sum(i, ctx, parse_ident)?;
                    i.expect_comma()?;
                    let max = Self::parse_sum(i, ctx, parse_ident)?;
                    Ok((Some(min), center, Some(max)))
                })?;

                // According to the spec, the minimum should "win" over the maximum if they are in the wrong order.
                let cmp = if let (Some(mx), Calc::Value(cv)) = (&max, &center) {
                    if let Calc::Value(mv) = mx {
                        protocol::PartialCmp::partial_cmp(&**cv, &**mv)
                    } else {
                        None
                    }
                } else {
                    None
                };

                // If center is known to be greater than the maximum, replace it with maximum and remove the max argument.
                // Otherwise, if center is known to be less than the maximum, remove the max argument.
                if let Some(cmp_val) = cmp {
                    if cmp_val == Ordering::Greater {
                        let val = max.take().unwrap();
                        center = val;
                    } else {
                        min = None;
                    }
                }

                Ok(match (min, max) {
                    (None, None) => center,
                    (Some(min), None) => Calc::Function(Box::new(MathFunction::Max(arr2(min, center)))),
                    (None, Some(max)) => Calc::Function(Box::new(MathFunction::Min(arr2(max, center)))),
                    (Some(min), Some(max)) => Calc::Function(Box::new(MathFunction::Clamp { min, center, max })),
                })
            }
            CalcUnit::Round => input.parse_nested_block(|i| {
                let strategy = if let Ok(s) = i.try_parse(RoundingStrategy::parse) {
                    i.expect_comma()?;
                    s
                } else {
                    RoundingStrategy::default()
                };

                Self::parse_math_fn(
                    i,
                    strategy,
                    |s, a, b| round((), a, b, s),
                    |s, a, b| MathFunction::Round {
                        strategy: s,
                        value: a,
                        interval: b,
                    },
                    ctx,
                    parse_ident,
                )
            }),
            CalcUnit::Rem => input.parse_nested_block(|i| {
                Self::parse_math_fn(
                    i,
                    (),
                    |_, a, b| {
                        // Zig `@mod(a, b)`: floored modulo, result takes sign of divisor.
                        // Equivalent to `a - b * floor(a / b)`. Rust `%` is truncated (sign of
                        // dividend) and `rem_euclid` is non-negative, so neither matches for
                        // negative `b` — use the explicit floor formula.
                        a - b * (a / b).floor()
                    },
                    |_, a, b| MathFunction::Rem {
                        dividend: a,
                        divisor: b,
                    },
                    ctx,
                    parse_ident,
                )
            }),
            CalcUnit::Mod => input.parse_nested_block(|i| {
                Self::parse_math_fn(
                    i,
                    (),
                    |_, a, b| {
                        // return ((a % b) + b) % b;
                        // TODO(port): Zig used nested `@mod`; using Rust `%` per the commented
                        // formula. Verify edge cases (negative b, NaN).
                        ((a % b) + b) % b
                    },
                    |_, a, b| MathFunction::Mod {
                        dividend: a,
                        divisor: b,
                    },
                    ctx,
                    parse_ident,
                )
            }),
            CalcUnit::Sin => Self::parse_trig(input, TrigFnKind::Sin, false, ctx, parse_ident),
            CalcUnit::Cos => Self::parse_trig(input, TrigFnKind::Cos, false, ctx, parse_ident),
            CalcUnit::Tan => Self::parse_trig(input, TrigFnKind::Tan, false, ctx, parse_ident),
            CalcUnit::Asin => Self::parse_trig(input, TrigFnKind::Asin, true, ctx, parse_ident),
            CalcUnit::Acos => Self::parse_trig(input, TrigFnKind::Acos, true, ctx, parse_ident),
            CalcUnit::Atan => Self::parse_trig(input, TrigFnKind::Atan, true, ctx, parse_ident),
            CalcUnit::Atan2 => input.parse_nested_block(|i| {
                let res = Self::parse_atan2(i, ctx, parse_ident)?;
                if let Some(v) = V::try_from_angle(res) {
                    return Ok(Calc::Value(Box::new(v)));
                }
                Err(i.new_custom_error(css::ParserError::invalid_value))
            }),
            CalcUnit::Pow => input.parse_nested_block(|i| {
                let a = Self::parse_numeric(i, ctx, parse_ident)?;
                i.expect_comma()?;
                let b = Self::parse_numeric(i, ctx, parse_ident)?;
                Ok(Calc::Number(a.powf(b)))
            }),
            CalcUnit::Log => input.parse_nested_block(|i| {
                let value = Self::parse_numeric(i, ctx, parse_ident)?;
                if i.try_parse(|p| p.expect_comma()).is_ok() {
                    let base = Self::parse_numeric(i, ctx, parse_ident)?;
                    return Ok(Calc::Number(value.log(base)));
                }
                Ok(Calc::Number(value.ln()))
            }),
            CalcUnit::Sqrt => Self::parse_numeric_fn(input, NumericFnOp::Sqrt, ctx, parse_ident),
            CalcUnit::Exp => Self::parse_numeric_fn(input, NumericFnOp::Exp, ctx, parse_ident),
            CalcUnit::Hypot => input.parse_nested_block(|i| {
                let mut args = i.parse_comma_separated(|i| Self::parse_sum(i, ctx, parse_ident))?;
                let val = Self::parse_hypot(&mut args)?;
                if let Some(v) = val {
                    return Ok(v);
                }
                Ok(Calc::Function(Box::new(MathFunction::Hypot(args))))
            }),
            CalcUnit::Abs => input.parse_nested_block(|i| {
                let v = Self::parse_sum(i, ctx, parse_ident)?;
                Ok(if let Some(vv) = Self::apply_map(&v, absf) {
                    vv
                } else {
                    Calc::Function(Box::new(MathFunction::Abs(v)))
                })
            }),
            CalcUnit::Sign => input.parse_nested_block(|i| {
                let v = Self::parse_sum(i, ctx, parse_ident)?;
                match &v {
                    Calc::Number(n) => return Ok(Calc::Number(std_math_sign(*n))),
                    Calc::Value(v2) => {
                        // First map so we ignore percentages, which must be resolved to their
                        // computed value in order to determine the sign.
                        if let Some(new_v) = v2.try_map(std_math_sign) {
                            // sign() alwasy resolves to a number.
                            return Ok(Calc::Number(new_v.try_sign().unwrap_or_else(|| {
                                panic!("sign() always resolves to a number.")
                            })));
                        }
                    }
                    _ => {}
                }
                Ok(Calc::Function(Box::new(MathFunction::Sign(v))))
            }),
        }
    }

    pub fn parse_numeric_fn<C: Copy>(
        input: &mut css::Parser,
        op: NumericFnOp,
        ctx: C,
        parse_ident: impl Fn(C, &[u8]) -> Option<Self> + Copy,
    ) -> CssResult<Self> {
        // PERF(port): was comptime monomorphization on `op` — profile in Phase B.
        input.parse_nested_block(|i| {
            let v = Self::parse_numeric(i, ctx, parse_ident)?;
            Ok(Calc::Number(match op {
                NumericFnOp::Sqrt => v.sqrt(),
                NumericFnOp::Exp => v.exp(),
            }))
        })
    }

    pub fn parse_math_fn<C: Copy, OC: Copy>(
        input: &mut css::Parser,
        ctx_for_op_and_fallback: OC,
        op: fn(OC, f32, f32) -> f32,
        fallback: fn(OC, Self, Self) -> MathFunction<V>,
        ctx_for_parse_ident: C,
        parse_ident: impl Fn(C, &[u8]) -> Option<Self> + Copy,
    ) -> CssResult<Self> {
        let a = Self::parse_sum(input, ctx_for_parse_ident, parse_ident)?;
        input.expect_comma()?;
        let b = Self::parse_sum(input, ctx_for_parse_ident, parse_ident)?;

        let val = Self::apply_op(&a, &b, ctx_for_op_and_fallback, op)
            .unwrap_or_else(|| Calc::Function(Box::new(fallback(ctx_for_op_and_fallback, a, b))));

        Ok(val)
    }

    pub fn parse_sum<C: Copy, F: Fn(C, &[u8]) -> Option<Self> + Copy>(
        input: &mut css::Parser,
        ctx: C,
        parse_ident: F,
    ) -> CssResult<Self> {
        let mut cur = Self::parse_product(input, ctx, parse_ident)?;
        loop {
            let start = input.state();
            let tok = match input.next_including_whitespace() {
                Ok(vv) => vv,
                Err(_) => {
                    input.reset(&start);
                    break;
                }
            };

            if matches!(tok, css::Token::Whitespace(_)) {
                if input.is_exhausted() {
                    break; // allow trailing whitespace
                }
                let next_tok = input.next()?.clone();
                if matches!(next_tok, css::Token::Delim(c) if c == b'+' as u32) {
                    let next = Self::parse_product(input, ctx, parse_ident)?;
                    cur = cur.add(next, input)?;
                } else if matches!(next_tok, css::Token::Delim(c) if c == b'-' as u32) {
                    let mut rhs = Self::parse_product(input, ctx, parse_ident)?;
                    rhs = rhs.mul_f32(-1.0);
                    cur = cur.add(rhs, input)?;
                } else {
                    return Err(input.new_unexpected_token_error(next_tok));
                }
                continue;
            }
            input.reset(&start);
            break;
        }

        Ok(cur)
    }

    pub fn parse_product<C: Copy, F: Fn(C, &[u8]) -> Option<Self> + Copy>(
        input: &mut css::Parser,
        ctx: C,
        parse_ident: F,
    ) -> CssResult<Self> {
        let mut node = Self::parse_value(input, ctx, parse_ident)?;
        loop {
            let start = input.state();
            let tok = match input.next() {
                Ok(vv) => vv,
                Err(_) => {
                    input.reset(&start);
                    break;
                }
            };

            if matches!(tok, css::Token::Delim(c) if *c == b'*' as u32) {
                // At least one of the operands must be a number.
                let rhs = Self::parse_value(input, ctx, parse_ident)?;
                if let Calc::Number(n) = rhs {
                    node = node.mul_f32(n);
                } else if let Calc::Number(val) = node {
                    node = rhs;
                    node = node.mul_f32(val);
                } else {
                    return Err(input.new_unexpected_token_error(css::Token::Delim(b'*' as u32)));
                }
            } else if matches!(tok, css::Token::Delim(c) if *c == b'/' as u32) {
                let rhs = Self::parse_value(input, ctx, parse_ident)?;
                if let Calc::Number(val) = rhs {
                    if val != 0.0 {
                        node = node.mul_f32(1.0 / val);
                        continue;
                    }
                }
                return Err(input.new_custom_error(css::ParserError::invalid_value));
            } else {
                input.reset(&start);
                break;
            }
        }
        Ok(node)
    }

    pub fn parse_value<C: Copy, F: Fn(C, &[u8]) -> Option<Self> + Copy>(
        input: &mut css::Parser,
        ctx: C,
        parse_ident: F,
    ) -> CssResult<Self> {
        // Parse nested calc() and other math functions.
        if let Ok(calc) = input.try_parse(Self::parse) {
            match calc {
                Calc::Function(f) => {
                    return match *f {
                        MathFunction::Calc(c) => Ok(c),
                        other => Ok(Calc::Function(Box::new(other))),
                    };
                }
                other => return Ok(other),
            }
        }

        if input.try_parse(|p| p.expect_parenthesis_block()).is_ok() {
            return input.parse_nested_block(|i| Self::parse_sum(i, ctx, parse_ident));
        }

        if let Ok(num) = input.try_parse(|p| p.expect_number()) {
            return Ok(Calc::Number(num));
        }

        if let Ok(constant) = input.try_parse(Constant::parse) {
            return Ok(Calc::Number(constant.into_f32()));
        }

        let location = input.current_source_location();
        // PORT NOTE: reshaped for borrowck — clone the next token inside the
        // try-parse so the ident slice is owned by the cloned `Token` rather
        // than laundered to `'static` from the `&mut Parser` borrow.
        if let Ok(ident) = input.try_parse(|p| {
            let tok = p.next()?.clone();
            match tok {
                css::Token::Ident(s) => Ok(s),
                other => Err(p.new_unexpected_token_error(other)),
            }
        }) {
            if let Some(c) = parse_ident(ctx, ident) {
                return Ok(c);
            }
            return Err(location.new_unexpected_token_error(css::Token::Ident(ident)));
        }

        let value = input.try_parse(|p| V::parse(p))?;
        Ok(Calc::Value(Box::new(value)))
    }

    pub fn parse_trig<C: Copy>(
        input: &mut css::Parser,
        trig_fn_kind: TrigFnKind,
        to_angle: bool,
        ctx: C,
        parse_ident: impl Fn(C, &[u8]) -> Option<Self> + Copy,
    ) -> CssResult<Self> {
        // PERF(port): was comptime monomorphization on `trig_fn_kind` — profile in Phase B.
        let trig_fn = move |x: f32| -> f32 {
            match trig_fn_kind {
                TrigFnKind::Sin => x.sin(),
                TrigFnKind::Cos => x.cos(),
                TrigFnKind::Tan => x.tan(),
                TrigFnKind::Asin => x.asin(),
                TrigFnKind::Acos => x.acos(),
                TrigFnKind::Atan => x.atan(),
            }
        };

        input.parse_nested_block(|i| {
            // PORT NOTE: Zig wrapped `parse_ident` to project `Calc<V>::Number` into
            // `Calc<Angle>::Number`. Rust closure does the same.
            let parse_ident_fn = |_self: (), ident: &[u8]| -> Option<Calc<Angle>> {
                let v = parse_ident(ctx, ident)?;
                if let Calc::Number(n) = v {
                    Some(Calc::Number(n))
                } else {
                    None
                }
            };
            // TODO(port): Zig passed `&closure` (a *@This()) as ctx; here we use `()` and
            // capture `ctx` via the outer closure. Verify `Calc<Angle>::parse_sum` signature.
            let v = Calc::<Angle>::parse_sum(i, (), parse_ident_fn)?;

            let rad: f32 = 'rad: {
                match &v {
                    Calc::Value(angle) => {
                        if !to_angle {
                            break 'rad trig_fn(angle.to_radians());
                        }
                    }
                    Calc::Number(n) => break 'rad trig_fn(*n),
                    _ => {}
                }
                return Err(i.new_custom_error(css::ParserError::invalid_value));
            };

            if to_angle && !rad.is_nan() {
                if let Some(val) = V::try_from_angle(Angle::Rad(rad)) {
                    return Ok(Calc::Value(Box::new(val)));
                }
                return Err(i.new_custom_error(css::ParserError::invalid_value));
            } else {
                return Ok(Calc::Number(rad));
            }
        })
    }

    pub fn parse_ident_none<C, Value>(_: C, _: &[u8]) -> Option<Calc<Value>> {
        None
    }

    pub fn parse_atan2<C: Copy>(
        input: &mut css::Parser,
        ctx: C,
        parse_ident: impl Fn(C, &[u8]) -> Option<Self> + Copy,
    ) -> CssResult<Angle> {
        // atan2 supports arguments of any <number>, <dimension>, or <percentage>, even ones that wouldn't
        // normally be supported by V. The only requirement is that the arguments be of the same type.
        // Try parsing with each type, and return the first one that parses successfully.
        //
        // blocked_on: values/length.rs un-gate — until Length is real,
        // `atan2(10px, 5px)` (and any other length-dimension pair) falls
        // through to the CSSNumber path below and errors with `invalid_value`,
        // diverging from Zig (`Angle::Rad(atan2(10,5))`). Tracked as a known
        // incompleteness; no behaviour stub is added because a partial
        // dimension matcher would mis-reduce mixed-unit lengths.
        if let Ok(v) = try_parse_atan2_args::<C, Length>(input, ctx) {
            return Ok(v);
        }
        if let Ok(v) = try_parse_atan2_args::<C, Percentage>(input, ctx) {
            return Ok(v);
        }
        if let Ok(v) = try_parse_atan2_args::<C, Angle>(input, ctx) {
            return Ok(v);
        }
        if let Ok(v) = try_parse_atan2_args::<C, Time>(input, ctx) {
            return Ok(v);
        }

        let parse_ident_fn = move |c: C, ident: &[u8]| -> Option<Calc<CSSNumber>> {
            let v = parse_ident(c, ident)?;
            if let Calc::Number(n) = v {
                Some(Calc::Number(n))
            } else {
                None
            }
        };
        // TODO(port): Zig threaded `&closure` here; Rust captures via fn-pointer wrapper.
        Calc::<CSSNumber>::parse_atan2_args(input, ctx, parse_ident_fn)
    }

    pub fn parse_atan2_args<C: Copy>(
        input: &mut css::Parser,
        ctx: C,
        parse_ident: impl Fn(C, &[u8]) -> Option<Self> + Copy,
    ) -> CssResult<Angle> {
        let a = Self::parse_sum(input, ctx, parse_ident)?;
        input.expect_comma()?;
        let b = Self::parse_sum(input, ctx, parse_ident)?;

        if let (Calc::Value(av), Calc::Value(bv)) = (&a, &b) {
            if let Some(v) = av.try_op_to(&**bv, (), |_, x, y| Angle::Rad(x.atan2(y))) {
                return Ok(v);
            }
        } else if let (Calc::Number(an), Calc::Number(bn)) = (&a, &b) {
            return Ok(Angle::Rad(an.atan2(*bn)));
        } else {
            // doo nothing
        }

        // We don't have a way to represent arguments that aren't angles, so just error.
        // This will fall back to an unparsed property, leaving the atan2() function intact.
        Err(input.new_custom_error(css::ParserError::invalid_value))
    }

    pub fn parse_numeric<C: Copy>(
        input: &mut css::Parser,
        ctx: C,
        parse_ident: impl Fn(C, &[u8]) -> Option<Self> + Copy,
    ) -> CssResult<f32> {
        let parse_ident_fn = move |c: C, ident: &[u8]| -> Option<Calc<CSSNumber>> {
            let v = parse_ident(c, ident)?;
            if let Calc::Number(n) = v {
                Some(Calc::Number(n))
            } else {
                None
            }
        };
        // TODO(port): Zig threaded `&closure` here; same reshape as parse_trig/parse_atan2.
        let v: Calc<CSSNumber> = Calc::<CSSNumber>::parse_sum(input, ctx, parse_ident_fn)?;
        let val = match v {
            Calc::Number(n) => n,
            Calc::Value(v) => *v,
            _ => return Err(input.new_custom_error(css::ParserError::invalid_value)),
        };
        Ok(val)
    }

    // PERF(port): `args` was arena bulk-free (ArrayList fed input.arena()) — profile in Phase B
    pub fn parse_hypot(args: &mut Vec<Self>) -> CssResult<Option<Self>> {
        if args.len() == 1 {
            let v = core::mem::replace(&mut args[0], Calc::Number(0.0));
            return Ok(Some(v));
        }

        if args.len() == 2 {
            return Ok(Self::apply_op(&args[0], &args[1], (), |_, a, b| {
                hypot((), a, b)
            }));
        }

        let mut i: usize = 0;
        let Some(first) = Self::apply_map(&args[0], powi2) else {
            return Ok(None);
        };
        i += 1;
        let mut errored = false;
        let mut sum = first;
        for arg in &args[i..] {
            let Some(next) = Self::apply_op(&sum, arg, (), |_, a, b| a + b.powf(2.0)) else {
                errored = true;
                break;
            };
            sum = next;
        }

        if errored {
            return Ok(None);
        }

        Ok(Self::apply_map(&sum, sqrtf32))
    }

    pub fn apply_op<OC: Copy>(
        a: &Self,
        b: &Self,
        ctx: OC,
        op: fn(OC, f32, f32) -> f32,
    ) -> Option<Self> {
        if let (Calc::Value(av), Calc::Value(bv)) = (a, b) {
            if let Some(v) = av.try_op(&**bv, ctx, op) {
                return Some(Calc::Value(Box::new(v)));
            }
            return None;
        }

        if let (Calc::Number(an), Calc::Number(bn)) = (a, b) {
            return Some(Calc::Number(op(ctx, *an, *bn)));
        }

        None
    }

    pub fn apply_map(this: &Self, op: fn(f32) -> f32) -> Option<Self> {
        match this {
            Calc::Number(n) => return Some(Calc::Number(op(*n))),
            Calc::Value(v) => {
                if let Some(new_v) = v.try_map(op) {
                    return Some(Calc::Value(Box::new(new_v)));
                }
            }
            _ => {}
        }
        None
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        let was_in_calc = dest.in_calc;
        dest.in_calc = true;

        let res = self.to_css_impl(dest);

        dest.in_calc = was_in_calc;
        res
    }

    pub fn to_css_impl(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            Calc::Value(v) => v.to_css(dest),
            Calc::Number(n) => CSSNumberFns::to_css(n, dest),
            Calc::Sum { left: a, right: b } => {
                a.to_css(dest)?;
                // White space is always required.
                if b.is_sign_negative() {
                    dest.write_str(b" - ")?;
                    let b2 = b.deep_clone().mul_f32(-1.0);
                    b2.to_css(dest)?;
                } else {
                    dest.write_str(b" + ")?;
                    b.to_css(dest)?;
                }
                Ok(())
            }
            Calc::Product { number, expression } => {
                let num = *number;
                let calc = expression;
                if num.abs() < 1.0 {
                    let div = 1.0 / num;
                    calc.to_css(dest)?;
                    dest.delim(b'/', true)?;
                    CSSNumberFns::to_css(&div, dest)?;
                } else {
                    CSSNumberFns::to_css(&num, dest)?;
                    dest.delim(b'*', true)?;
                    calc.to_css(dest)?;
                }
                Ok(())
            }
            Calc::Function(f) => f.to_css(dest),
        }
    }

    pub fn try_sign(&self) -> Option<f32> {
        match self {
            Calc::Value(v) => v.try_sign(),
            Calc::Number(n) => Some(css::signfns::sign_f32(*n)),
            _ => None,
        }
    }

    pub fn is_sign_negative(&self) -> bool {
        let Some(s) = self.try_sign() else {
            return false;
        };
        s.is_sign_negative()
    }

    pub fn mul_f32(self, other: f32) -> Self {
        if other == 1.0 {
            return self;
        }

        match self {
            // PERF: why not reuse the allocation here?
            Calc::Value(v) => Calc::Value(Box::new(Self::mul_value_f32(*v, other))),
            Calc::Number(n) => Calc::Number(n * other),
            // PERF: why not reuse the allocation here?
            Calc::Sum { left, right } => Calc::Sum {
                left: Box::new(left.mul_f32(other)),
                right: Box::new(right.mul_f32(other)),
            },
            Calc::Product { number, expression } => {
                let num = number * other;
                if num == 1.0 {
                    return *expression;
                }
                Calc::Product {
                    number: num,
                    expression,
                }
            }
            Calc::Function(f) => match *f {
                // PERF: why not reuse the allocation here?
                MathFunction::Calc(c) => {
                    Calc::Function(Box::new(MathFunction::Calc(c.mul_f32(other))))
                }
                other_fn => Calc::Product {
                    number: other,
                    expression: Box::new(Calc::Function(Box::new(other_fn))),
                },
            },
        }
    }

    /// PERF:
    /// I don't like how this function requires allocating a second ArrayList
    /// I am pretty sure we could do this reduction in place, or do it as the
    /// arguments are being parsed.
    // PERF(port): `args`/`reduced` were arena bulk-free (ArrayList fed input.arena()) — profile in Phase B
    fn reduce_args(args: &mut Vec<Self>, order: Ordering) {
        // Reduces the arguments of a min() or max() expression, combining compatible values.
        // e.g. min(1px, 1em, 2px, 3in) => min(1px, 1em)
        let mut reduced: Vec<Self> = Vec::new();

        for arg in args.iter_mut() {
            let mut found: Option<Option<usize>> = None;
            if let Calc::Value(val) = &*arg {
                for (idx, b) in reduced.iter().enumerate() {
                    if let Calc::Value(v) = b {
                        let result = protocol::PartialCmp::partial_cmp(&**val, &**v);
                        if result.is_some() {
                            if result == Some(order) {
                                found = Some(Some(idx));
                                break;
                            } else {
                                found = Some(None);
                                break;
                            }
                        }
                    }
                }
            }

            // PORT NOTE: reshaped for borrowck — Zig stored `?*This`; Rust stores index.
            if let Some(maybe_idx) = found {
                if let Some(idx) = maybe_idx {
                    reduced[idx] = core::mem::replace(arg, Calc::Number(420.0));
                    continue;
                }
            } else {
                reduced.push(core::mem::replace(arg, Calc::Number(420.0)));
                // PERF(port): was assume_capacity-free append
                continue;
            }
            // arg dropped here (Zig: arg.deinit + dummy)
            *arg = Calc::Number(420.0);
        }

        // Zig: css.deepDeinit(This, arena, args) — Rust: Drop on replace handles it.
        *args = reduced;
    }

    pub fn is_compatible(&self, browsers: css::targets::Browsers) -> bool {
        match self {
            Calc::Sum { left, right } => {
                left.is_compatible(browsers) && right.is_compatible(browsers)
            }
            Calc::Product { expression, .. } => expression.is_compatible(browsers),
            Calc::Function(f) => f.is_compatible(browsers),
            Calc::Value(v) => v.is_compatible(browsers),
            Calc::Number(_) => true,
        }
    }
}

#[inline]
fn try_parse_atan2_args<C: Copy, Value: CalcValue>(
    input: &mut css::Parser,
    ctx: C,
) -> CssResult<Angle> {
    let func = Calc::<Value>::parse_ident_none::<C, Value>;
    input.try_parse(|i| Calc::<Value>::parse_atan2_args(i, ctx, func))
}

#[derive(Copy, Clone)]
pub enum NumericFnOp {
    Sqrt,
    Exp,
}

#[derive(Copy, Clone)]
pub enum TrigFnKind {
    Sin,
    Cos,
    Tan,
    Asin,
    Acos,
    Atan,
}

/// A CSS math function.
///
/// Math functions may be used in most properties and values that accept numeric
/// values, including lengths, percentages, angles, times, etc.
pub enum MathFunction<V> {
    /// The `calc()` function.
    Calc(Calc<V>),
    /// The `min()` function.
    // PERF(port): was arena bulk-free (ArrayList fed input.arena()) — profile in Phase B
    Min(Vec<Calc<V>>),
    /// The `max()` function.
    // PERF(port): was arena bulk-free (ArrayList fed input.arena()) — profile in Phase B
    Max(Vec<Calc<V>>),
    /// The `clamp()` function.
    Clamp {
        min: Calc<V>,
        center: Calc<V>,
        max: Calc<V>,
    },
    /// The `round()` function.
    Round {
        strategy: RoundingStrategy,
        value: Calc<V>,
        interval: Calc<V>,
    },
    /// The `rem()` function.
    Rem { dividend: Calc<V>, divisor: Calc<V> },
    /// The `mod()` function.
    Mod { dividend: Calc<V>, divisor: Calc<V> },
    /// The `abs()` function.
    Abs(Calc<V>),
    /// The `sign()` function.
    Sign(Calc<V>),
    /// The `hypot()` function.
    // PERF(port): was arena bulk-free (ArrayList fed input.arena()) — profile in Phase B
    Hypot(Vec<Calc<V>>),
}

impl<V: PartialEq + Clone> PartialEq for MathFunction<V> {
    fn eq(&self, other: &Self) -> bool {
        // Mirrors `MathFunction::eql` but bounds only on `V: PartialEq` so
        // `Calc<V>: PartialEq` (above) closes without `CalcValue`.
        match (self, other) {
            (MathFunction::Calc(a), MathFunction::Calc(b)) => a == b,
            (MathFunction::Min(a), MathFunction::Min(b)) => a == b,
            (MathFunction::Max(a), MathFunction::Max(b)) => a == b,
            (
                MathFunction::Clamp {
                    min: a0,
                    center: a1,
                    max: a2,
                },
                MathFunction::Clamp {
                    min: b0,
                    center: b1,
                    max: b2,
                },
            ) => a0 == b0 && a1 == b1 && a2 == b2,
            (
                MathFunction::Round {
                    strategy: as_,
                    value: av,
                    interval: ai,
                },
                MathFunction::Round {
                    strategy: bs,
                    value: bv,
                    interval: bi,
                },
            ) => as_ == bs && av == bv && ai == bi,
            (
                MathFunction::Rem {
                    dividend: ad,
                    divisor: av,
                },
                MathFunction::Rem {
                    dividend: bd,
                    divisor: bv,
                },
            ) => ad == bd && av == bv,
            (
                MathFunction::Mod {
                    dividend: ad,
                    divisor: av,
                },
                MathFunction::Mod {
                    dividend: bd,
                    divisor: bv,
                },
            ) => ad == bd && av == bv,
            (MathFunction::Abs(a), MathFunction::Abs(b)) => a == b,
            (MathFunction::Sign(a), MathFunction::Sign(b)) => a == b,
            (MathFunction::Hypot(a), MathFunction::Hypot(b)) => a == b,
            _ => false,
        }
    }
}

fn eql_calc_list<V: CalcValue>(a: &[Calc<V>], b: &[Calc<V>]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    for (l, r) in a.iter().zip(b.iter()) {
        if !l.eql(r) {
            return false;
        }
    }
    true
}

impl<V> MathFunction<V> {
    pub fn eql(&self, other: &Self) -> bool
    where
        V: CalcValue,
    {
        match (self, other) {
            (MathFunction::Calc(a), MathFunction::Calc(b)) => a.eql(b),
            (MathFunction::Min(a), MathFunction::Min(b)) => eql_calc_list(a, b),
            (MathFunction::Max(a), MathFunction::Max(b)) => eql_calc_list(a, b),
            (
                MathFunction::Clamp {
                    min: a0,
                    center: a1,
                    max: a2,
                },
                MathFunction::Clamp {
                    min: b0,
                    center: b1,
                    max: b2,
                },
            ) => a0.eql(b0) && a1.eql(b1) && a2.eql(b2),
            (
                MathFunction::Round {
                    strategy: as_,
                    value: av,
                    interval: ai,
                },
                MathFunction::Round {
                    strategy: bs,
                    value: bv,
                    interval: bi,
                },
            ) => as_ == bs && av.eql(bv) && ai.eql(bi),
            (
                MathFunction::Rem {
                    dividend: ad,
                    divisor: av,
                },
                MathFunction::Rem {
                    dividend: bd,
                    divisor: bv,
                },
            ) => ad.eql(bd) && av.eql(bv),
            (
                MathFunction::Mod {
                    dividend: ad,
                    divisor: av,
                },
                MathFunction::Mod {
                    dividend: bd,
                    divisor: bv,
                },
            ) => ad.eql(bd) && av.eql(bv),
            (MathFunction::Abs(a), MathFunction::Abs(b)) => a.eql(b),
            (MathFunction::Sign(a), MathFunction::Sign(b)) => a.eql(b),
            (MathFunction::Hypot(a), MathFunction::Hypot(b)) => eql_calc_list(a, b),
            _ => false,
        }
    }

    pub fn deep_clone(&self) -> Self
    where
        V: Clone,
    {
        match self {
            MathFunction::Calc(calc) => MathFunction::Calc(calc.deep_clone()),
            MathFunction::Min(min) => MathFunction::Min(min.clone()),
            MathFunction::Max(max) => MathFunction::Max(max.clone()),
            MathFunction::Clamp { min, center, max } => MathFunction::Clamp {
                min: min.deep_clone(),
                center: center.deep_clone(),
                max: max.deep_clone(),
            },
            MathFunction::Round {
                strategy,
                value,
                interval,
            } => MathFunction::Round {
                strategy: *strategy,
                value: value.deep_clone(),
                interval: interval.deep_clone(),
            },
            MathFunction::Rem { dividend, divisor } => MathFunction::Rem {
                dividend: dividend.deep_clone(),
                divisor: divisor.deep_clone(),
            },
            MathFunction::Mod { dividend, divisor } => MathFunction::Mod {
                dividend: dividend.deep_clone(),
                divisor: divisor.deep_clone(),
            },
            MathFunction::Abs(abs) => MathFunction::Abs(abs.deep_clone()),
            MathFunction::Sign(sign) => MathFunction::Sign(sign.deep_clone()),
            MathFunction::Hypot(hyp) => MathFunction::Hypot(hyp.clone()),
        }
    }

    // Zig `deinit` only freed owned Vec/Calc fields → handled by Drop. No explicit impl.

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr>
    where
        V: CalcValue,
    {
        match self {
            MathFunction::Calc(calc) => {
                dest.write_str("calc(")?;
                calc.to_css(dest)?;
                dest.write_char(b')')
            }
            MathFunction::Min(args) => {
                dest.write_str("min(")?;
                dest.write_comma_separated(args, |d, arg| arg.to_css(d))?;
                dest.write_char(b')')
            }
            MathFunction::Max(args) => {
                dest.write_str("max(")?;
                dest.write_comma_separated(args, |d, arg| arg.to_css(d))?;
                dest.write_char(b')')
            }
            MathFunction::Clamp { min, center, max } => {
                dest.write_str("clamp(")?;
                min.to_css(dest)?;
                dest.delim(b',', false)?;
                center.to_css(dest)?;
                dest.delim(b',', false)?;
                max.to_css(dest)?;
                dest.write_char(b')')
            }
            MathFunction::Round {
                strategy,
                value,
                interval,
            } => {
                dest.write_str("round(")?;
                if *strategy != RoundingStrategy::default() {
                    strategy.to_css(dest)?;
                    dest.delim(b',', false)?;
                }
                value.to_css(dest)?;
                dest.delim(b',', false)?;
                interval.to_css(dest)?;
                dest.write_char(b')')
            }
            MathFunction::Rem { dividend, divisor } => {
                dest.write_str("rem(")?;
                dividend.to_css(dest)?;
                dest.delim(b',', false)?;
                divisor.to_css(dest)?;
                dest.write_char(b')')
            }
            MathFunction::Mod { dividend, divisor } => {
                dest.write_str("mod(")?;
                dividend.to_css(dest)?;
                dest.delim(b',', false)?;
                divisor.to_css(dest)?;
                dest.write_char(b')')
            }
            MathFunction::Abs(v) => {
                dest.write_str("abs(")?;
                v.to_css(dest)?;
                dest.write_char(b')')
            }
            MathFunction::Sign(v) => {
                dest.write_str("sign(")?;
                v.to_css(dest)?;
                dest.write_char(b')')
            }
            MathFunction::Hypot(args) => {
                dest.write_str("hypot(")?;
                dest.write_comma_separated(args, |d, arg| arg.to_css(d))?;
                dest.write_char(b')')
            }
        }
    }

    pub fn is_compatible(&self, browsers: css::targets::Browsers) -> bool
    where
        V: CalcValue,
    {
        use crate::compat::Feature as F;
        match self {
            MathFunction::Calc(c) => {
                F::CalcFunction.is_compatible(browsers) && c.is_compatible(browsers)
            }
            MathFunction::Min(m) => {
                F::MinFunction.is_compatible(browsers)
                    && m.iter().all(|arg| arg.is_compatible(browsers))
            }
            MathFunction::Max(m) => {
                F::MaxFunction.is_compatible(browsers)
                    && m.iter().all(|arg| arg.is_compatible(browsers))
            }
            MathFunction::Clamp { min, center, max } => {
                F::ClampFunction.is_compatible(browsers)
                    && min.is_compatible(browsers)
                    && center.is_compatible(browsers)
                    && max.is_compatible(browsers)
            }
            MathFunction::Round {
                value, interval, ..
            } => {
                F::RoundFunction.is_compatible(browsers)
                    && value.is_compatible(browsers)
                    && interval.is_compatible(browsers)
            }
            MathFunction::Rem { dividend, divisor } => {
                F::RemFunction.is_compatible(browsers)
                    && dividend.is_compatible(browsers)
                    && divisor.is_compatible(browsers)
            }
            MathFunction::Mod { dividend, divisor } => {
                F::ModFunction.is_compatible(browsers)
                    && dividend.is_compatible(browsers)
                    && divisor.is_compatible(browsers)
            }
            MathFunction::Abs(a) => {
                F::AbsFunction.is_compatible(browsers) && a.is_compatible(browsers)
            }
            MathFunction::Sign(s) => {
                F::SignFunction.is_compatible(browsers) && s.is_compatible(browsers)
            }
            MathFunction::Hypot(h) => {
                F::HypotFunction.is_compatible(browsers)
                    && h.iter().all(|arg| arg.is_compatible(browsers))
            }
        }
    }
}

/// A [rounding strategy](https://www.w3.org/TR/css-values-4/#typedef-rounding-strategy),
/// as used in the `round()` function.
#[derive(Copy, Clone, PartialEq, Eq, Default, css::DefineEnumProperty)]
pub enum RoundingStrategy {
    /// Round to the nearest integer.
    #[default]
    Nearest,
    /// Round up (ceil).
    Up,
    /// Round down (floor).
    Down,
    /// Round toward zero (truncate).
    ToZero,
}

fn arr2<T>(a: T, b: T) -> Vec<T> {
    // PERF(port): was arena bulk-free (ArrayList fed input.arena()) — profile in Phase B
    vec![a, b]
}

fn round(_: (), value: f32, to: f32, strategy: RoundingStrategy) -> f32 {
    let v = value / to;
    match strategy {
        RoundingStrategy::Down => v.floor() * to,
        RoundingStrategy::Up => v.ceil() * to,
        RoundingStrategy::Nearest => v.round() * to,
        RoundingStrategy::ToZero => v.trunc() * to,
    }
}

fn hypot(_: (), a: f32, b: f32) -> f32 {
    a.hypot(b)
}

fn powi2(v: f32) -> f32 {
    v.powf(2.0)
}

fn sqrtf32(v: f32) -> f32 {
    v.sqrt()
}

/// Zig `std.math.sign` — returns -1.0, 0.0, or 1.0 (NOT Rust's `f32::signum`, which
/// returns ±1.0 for ±0.0).
fn std_math_sign(v: f32) -> f32 {
    if v > 0.0 {
        1.0
    } else if v < 0.0 {
        -1.0
    } else {
        v // preserves ±0.0 / NaN
    }
}

/// A mathematical constant.
#[derive(Copy, Clone, PartialEq, Eq, css::DefineEnumProperty)]
pub enum Constant {
    /// The base of the natural logarithm
    E,
    /// The ratio of a circle's circumference to its diameter
    Pi,
    /// infinity
    Infinity,
    /// -infinity
    #[css(keyword = "-infinity")]
    NegInfinity,
    /// Not a number.
    Nan,
}

impl Constant {
    pub fn into_f32(&self) -> f32 {
        match self {
            Constant::E => core::f32::consts::E,
            Constant::Pi => core::f32::consts::PI,
            Constant::Infinity => f32::INFINITY,
            Constant::NegInfinity => f32::NEG_INFINITY,
            Constant::Nan => f32::NAN,
        }
    }
}

fn absf(a: f32) -> f32 {
    a.abs()
}

// ───────────────────────── CalcValue impls ─────────────────────────────────
// One impl per concrete `V` that `Calc<V>` is instantiated with. The
// numeric-protocol surface (`mul_f32`/`try_sign`/`try_map`/`try_op{,_to}`/
// `partial_cmp`/`try_from_angle`/`parse`/`to_css`/`is_compatible`) is
// satisfied via `crate::values::protocol::*` supertraits; only the
// calc-specific Zig `switch (V)` arms (`intoValue` / `addValue` / `intoCalc`
// / `eql`) live here.
//
// Any type whose protocol impls don't already exist elsewhere gets them
// immediately below its `CalcValue` impl as one-line forwarders to the
// inherent method.

impl CalcValue for CSSNumber {
    #[inline]
    fn add_internal(self, rhs: Self) -> Self {
        self + rhs
    }
    #[inline]
    fn into_calc(self) -> Calc<Self> {
        Calc::Value(Box::new(self))
    }
    fn from_calc(c: Calc<Self>, input: &mut css::Parser) -> CssResult<Self> {
        match c {
            Calc::Value(v) => Ok(*v),
            Calc::Number(n) => Ok(n),
            _ => Err(input.new_custom_error(css::ParserError::invalid_value)),
        }
    }
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        *self == *other
    }
}

impl CalcValue for Angle {
    #[inline]
    fn add_internal(self, rhs: Self) -> Self {
        Angle::add_internal(self, rhs)
    }
    #[inline]
    fn into_calc(self) -> Calc<Self> {
        Calc::Value(Box::new(self))
    }
    fn from_calc(c: Calc<Self>, input: &mut css::Parser) -> CssResult<Self> {
        match c {
            Calc::Value(v) => Ok(*v),
            _ => Err(input.new_custom_error(css::ParserError::invalid_value)),
        }
    }
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        Angle::eql(self, other)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// `protocol::*` forwarder stamper for `CalcValue` leaf types.
//
// Rust analogue of Zig's single comptime dispatcher in `src/css/generics.zig`
// (`tryFromAngle`/`trySign`/`tryMap`/`tryOp`/`tryOpTo`/`partialCmp`, lines
// ~489-570), which duck-types via `@hasDecl(T, "sign")` etc. Here each leaf
// opts in per-trait; only the listed arms are stamped — `Parse`/`ToCss`/
// `IsCompatible` already supplied by `impl_parse_tocss_via_inherent!` /
// `bridge_is_compatible!` stay out of the invocation.
//
// Arm vocab (each `arm: spec,` — trailing comma required):
//   mul_f32:        forward
//   partial_cmp:    forward
//   try_from_angle: forward | none
//   try_sign:       forward | <ident>   (ident = infallible inherent → `Some`)
//   try_map:        forward | <ident>
//   try_op:         forward | |rhs, ctx, f| { <body> }   (idents = param names;
//   try_op_to:      |rhs, ctx, f| { <body, generic R> }   captured for hygiene)
//   is_compatible:  forward | always_true
//   parse_to_css:   forward             (stamps both `Parse` + `ToCss`)
macro_rules! calc_protocol_forwarders {
    ($T:ty { $($arms:tt)* }) => { calc_protocol_forwarders!(@ $T; $($arms)*); };
    (@ $T:ty;) => {};
    (@ $T:ty; mul_f32: forward, $($r:tt)*) => {
        impl protocol::MulF32 for $T { #[inline] fn mul_f32(self, rhs: f32) -> Self { <$T>::mul_f32(self, rhs) } }
        calc_protocol_forwarders!(@ $T; $($r)*);
    };
    (@ $T:ty; partial_cmp: forward, $($r:tt)*) => {
        impl protocol::PartialCmp for $T { #[inline] fn partial_cmp(&self, rhs: &Self) -> Option<Ordering> { <$T>::partial_cmp(self, rhs) } }
        calc_protocol_forwarders!(@ $T; $($r)*);
    };
    (@ $T:ty; try_from_angle: forward, $($r:tt)*) => {
        impl protocol::TryFromAngle for $T { #[inline] fn try_from_angle(a: Angle) -> Option<Self> { <$T>::try_from_angle(a) } }
        calc_protocol_forwarders!(@ $T; $($r)*);
    };
    (@ $T:ty; try_from_angle: none, $($r:tt)*) => {
        impl protocol::TryFromAngle for $T { #[inline] fn try_from_angle(_: Angle) -> Option<Self> { None } }
        calc_protocol_forwarders!(@ $T; $($r)*);
    };
    (@ $T:ty; try_sign: forward, $($r:tt)*) => {
        impl protocol::TrySign for $T { #[inline] fn try_sign(&self) -> Option<f32> { <$T>::try_sign(self) } }
        calc_protocol_forwarders!(@ $T; $($r)*);
    };
    (@ $T:ty; try_sign: $m:ident, $($r:tt)*) => {
        impl protocol::TrySign for $T { #[inline] fn try_sign(&self) -> Option<f32> { Some(self.$m()) } }
        calc_protocol_forwarders!(@ $T; $($r)*);
    };
    (@ $T:ty; try_map: forward, $($r:tt)*) => {
        impl protocol::TryMap for $T { #[inline] fn try_map(&self, f: impl Fn(f32) -> f32) -> Option<Self> { <$T>::try_map(self, f) } }
        calc_protocol_forwarders!(@ $T; $($r)*);
    };
    (@ $T:ty; try_map: $m:ident, $($r:tt)*) => {
        impl protocol::TryMap for $T { #[inline] fn try_map(&self, f: impl Fn(f32) -> f32) -> Option<Self> { Some(self.$m(f)) } }
        calc_protocol_forwarders!(@ $T; $($r)*);
    };
    (@ $T:ty; try_op: forward, $($r:tt)*) => {
        impl protocol::TryOp for $T {
            #[inline] fn try_op<C>(&self, rhs: &Self, ctx: C, f: impl Fn(C, f32, f32) -> f32) -> Option<Self> { <$T>::try_op(self, rhs, ctx, f) }
        }
        calc_protocol_forwarders!(@ $T; $($r)*);
    };
    // Closure-ish syntax so `$this/$rhs/$ctx/$f` carry call-site hygiene into
    // the param list (macro_rules! fn-params are hygienic — `self` does not
    // resolve in a `:block` from the call site, so the caller binds it via
    // `$this`).
    (@ $T:ty; try_op: |$this:ident, $rhs:ident, $ctx:ident, $f:ident| $body:block, $($r:tt)*) => {
        impl protocol::TryOp for $T {
            #[inline] fn try_op<C>(&self, $rhs: &Self, $ctx: C, $f: impl Fn(C, f32, f32) -> f32) -> Option<Self> {
                let $this = self;
                $body
            }
        }
        calc_protocol_forwarders!(@ $T; $($r)*);
    };
    (@ $T:ty; try_op_to: |$this:ident, $rhs:ident, $ctx:ident, $f:ident| $body:block, $($r:tt)*) => {
        impl protocol::TryOpTo for $T {
            #[inline] fn try_op_to<R, C>(&self, $rhs: &Self, $ctx: C, $f: impl Fn(C, f32, f32) -> R) -> Option<R> {
                let $this = self;
                $body
            }
        }
        calc_protocol_forwarders!(@ $T; $($r)*);
    };
    (@ $T:ty; is_compatible: forward, $($r:tt)*) => {
        impl protocol::IsCompatible for $T { #[inline] fn is_compatible(&self, b: css::targets::Browsers) -> bool { <$T>::is_compatible(self, b) } }
        calc_protocol_forwarders!(@ $T; $($r)*);
    };
    (@ $T:ty; is_compatible: always_true, $($r:tt)*) => {
        impl protocol::IsCompatible for $T { #[inline] fn is_compatible(&self, _: css::targets::Browsers) -> bool { true } }
        calc_protocol_forwarders!(@ $T; $($r)*);
    };
    (@ $T:ty; parse_to_css: forward, $($r:tt)*) => {
        impl protocol::Parse for $T { #[inline] fn parse(input: &mut css::Parser) -> CssResult<Self> { <$T>::parse(input) } }
        impl protocol::ToCss for $T { #[inline] fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> { <$T>::to_css(self, dest) } }
        calc_protocol_forwarders!(@ $T; $($r)*);
    };
}

calc_protocol_forwarders!(Percentage {
    mul_f32: forward,
    try_from_angle: none,
    try_sign: forward,
    try_map: forward,
    try_op: forward,
    try_op_to: |this, rhs, ctx, f| { Some(this.op_to(rhs, ctx, f)) },
    partial_cmp: forward,
    is_compatible: always_true,
    parse_to_css: forward,
});
impl CalcValue for Percentage {
    #[inline]
    fn add_internal(self, rhs: Self) -> Self {
        Percentage::add_internal(self, rhs)
    }
    #[inline]
    fn into_calc(self) -> Calc<Self> {
        Calc::Value(Box::new(self))
    }
    fn from_calc(c: Calc<Self>, _input: &mut css::Parser) -> CssResult<Self> {
        match c {
            Calc::Value(v) => Ok(*v),
            // Zig: else → Percentage { v: NaN }
            _ => Ok(Percentage { v: f32::NAN }),
        }
    }
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        Percentage::eql(self, other)
    }
}

calc_protocol_forwarders!(Time {
    mul_f32: forward,
    try_from_angle: none,
    try_sign: sign,
    try_map: map,
    try_op: |this, rhs, ctx, f| {
        // Inline `Time::op` body so `ctx` (no `Copy` bound) is consumed once.
        Some(match (*this, *rhs) {
            (Time::Seconds(a), Time::Seconds(b)) => Time::Seconds(f(ctx, a, b)),
            (Time::Milliseconds(a), Time::Milliseconds(b)) => Time::Milliseconds(f(ctx, a, b)),
            (Time::Seconds(a), Time::Milliseconds(b)) => Time::Seconds(f(ctx, a, b / 1000.0)),
            (Time::Milliseconds(a), Time::Seconds(b)) => Time::Milliseconds(f(ctx, a, b * 1000.0)),
        })
    },
    try_op_to: |this, rhs, ctx, f| {
        Some(match (*this, *rhs) {
            (Time::Seconds(a), Time::Seconds(b)) => f(ctx, a, b),
            (Time::Milliseconds(a), Time::Milliseconds(b)) => f(ctx, a, b),
            (Time::Seconds(a), Time::Milliseconds(b)) => f(ctx, a, b / 1000.0),
            (Time::Milliseconds(a), Time::Seconds(b)) => f(ctx, a, b * 1000.0),
        })
    },
    partial_cmp: forward,
    is_compatible: always_true,
});
impl CalcValue for Time {
    #[inline]
    fn add_internal(self, rhs: Self) -> Self {
        Time::add_internal(self, rhs)
    }
    #[inline]
    fn into_calc(self) -> Calc<Self> {
        Calc::Value(Box::new(self))
    }
    fn from_calc(c: Calc<Self>, input: &mut css::Parser) -> CssResult<Self> {
        match c {
            Calc::Value(v) => Ok(*v),
            _ => Err(input.new_custom_error(css::ParserError::invalid_value)),
        }
    }
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        Time::eql(self, other)
    }
}

calc_protocol_forwarders!(Length {
    mul_f32: forward,
    try_from_angle: none,
    try_sign: forward,
    try_map: forward,
    try_op: |this, rhs, ctx, f| {
        // Delegate to `protocol::TryOp for LengthValue` (which inlines the
        // same-unit/px-convert dispatch) rather than the inherent `Length::try_op`
        // — the inherent takes a 2-arg `Fn` closure, and adapting our 3-arg `f`
        // to that without `C: Copy` would only yield `FnOnce`.
        if let (Length::Value(a), Length::Value(b)) = (this, rhs) {
            return <LengthValue as protocol::TryOp>::try_op(a, b, ctx, f).map(Length::Value);
        }
        None
    },
    try_op_to: |this, rhs, ctx, f| {
        if let (Length::Value(a), Length::Value(b)) = (this, rhs) {
            return <LengthValue as protocol::TryOpTo>::try_op_to(a, b, ctx, f);
        }
        None
    },
    partial_cmp: forward,
});
impl CalcValue for Length {
    #[inline]
    fn add_internal(self, rhs: Self) -> Self {
        Length::add_internal(self, rhs)
    }
    #[inline]
    fn into_calc(self) -> Calc<Self> {
        Length::into_calc(self)
    }
    fn from_calc(c: Calc<Self>, _input: &mut css::Parser) -> CssResult<Self> {
        // Zig: Length { .calc = Box::new(self) }
        Ok(Length::Calc(Box::new(c)))
    }
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        self == other
    }
}

/// `protocol::*` + `CalcValue` impls for the two concrete `DimensionPercentage<D>`
/// instantiations that participate in `Calc<V>`. Kept as a macro (rather than
/// a blanket `impl<D: …>`) so coherence doesn't tangle with the `where Self:
/// CalcValue` bounds on the inherent methods these forward to. Trailing extra
/// arms (e.g. `parse_to_css: forward,`) are forwarded into
/// `calc_protocol_forwarders!` — `LengthPercentage` already gets `Parse`/`ToCss`
/// from `impl_parse_tocss_via_inherent!`, only `Angle` needs them stamped here.
macro_rules! dim_pct_protocol {
    ($D:ty $(, $($extra:tt)*)?) => {
        calc_protocol_forwarders!(DimensionPercentage<$D> {
            mul_f32: forward,
            try_from_angle: forward,
            try_sign: forward,
            try_map: forward,
            try_op: |this, rhs, ctx, f| {
                match (this, rhs) {
                    (DimensionPercentage::Dimension(a), DimensionPercentage::Dimension(b)) => {
                        Some(DimensionPercentage::Dimension(<$D as protocol::TryOp>::try_op(a, b, ctx, f)?))
                    }
                    (DimensionPercentage::Percentage(a), DimensionPercentage::Percentage(b)) => {
                        Some(DimensionPercentage::Percentage(Percentage { v: f(ctx, a.v, b.v) }))
                    }
                    _ => None,
                }
            },
            try_op_to: |this, rhs, ctx, f| {
                match (this, rhs) {
                    (DimensionPercentage::Dimension(a), DimensionPercentage::Dimension(b)) => {
                        <$D as protocol::TryOpTo>::try_op_to(a, b, ctx, f)
                    }
                    (DimensionPercentage::Percentage(a), DimensionPercentage::Percentage(b)) => {
                        Some(f(ctx, a.v, b.v))
                    }
                    _ => None,
                }
            },
            partial_cmp: forward,
            is_compatible: forward,
            $($($extra)*)?
        });
        impl CalcValue for DimensionPercentage<$D> {
            #[inline] fn add_internal(self, rhs: Self) -> Self { DimensionPercentage::add_internal(self, rhs) }
            #[inline] fn into_calc(self) -> Calc<Self> { DimensionPercentage::into_calc(self) }
            fn from_calc(c: Calc<Self>, _input: &mut css::Parser) -> CssResult<Self> {
                Ok(DimensionPercentage::Calc(Box::new(c)))
            }
            #[inline] fn eql(&self, other: &Self) -> bool { DimensionPercentage::eql(self, other) }
        }
    };
}
dim_pct_protocol!(LengthValue);
dim_pct_protocol!(Angle, parse_to_css: forward,);

// ported from: src/css/values/calc.zig
