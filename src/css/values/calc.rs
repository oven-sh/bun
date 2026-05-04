use crate as css;
use crate::css_values::angle::Angle;
use crate::css_values::length::{Length, LengthValue};
use crate::css_values::number::{CSSNumber, CSSNumberFns};
use crate::css_values::percentage::{DimensionPercentage, Percentage};
use crate::css_values::time::Time;
use crate::{PrintErr, Printer, Result as CssResult};

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
        // PERF(port): Zig used a comptime perfect hash; this allocates nothing but
        // does a linear strum match after lowercasing. Phase B: phf_map! over &[u8].
        let s = core::str::from_utf8(f).ok()?;
        s.parse::<CalcUnit>()
            .ok()
            .or_else(|| s.to_ascii_lowercase().parse().ok())
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

// TODO(port): define a `CalcValue` trait collecting the methods Zig dispatches on V:
//   mulF32, addInternal, intoCalc, toCss, trySign, isCompatible, tryFromAngle, tryMap,
//   tryOp, tryOpTo, partialCmp, parse. The Zig used `switch (V)` / `@hasDecl` for this.
//   For Phase A the generic methods below carry ad-hoc bounds and `// TODO(port)` at
//   each comptime-type-switch site.

impl<V: Clone> Clone for Calc<V> {
    fn clone(&self) -> Self {
        self.deep_clone()
    }
}

impl<V> Calc<V> {
    pub fn deep_clone(&self) -> Self
    where
        V: Clone,
    {
        match self {
            Calc::Value(v) => {
                // Zig: if (needs_deepclone) v.deepClone(allocator) else v.*
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

    // Zig `deinit` only freed owned Box fields → handled by Drop on Box<V>/Box<Calc<V>>/
    // Box<MathFunction<V>>. No explicit Drop impl needed.

    pub fn eql(&self, other: &Self) -> bool
    where
        V: PartialEq,
    {
        match (self, other) {
            (Calc::Value(a), Calc::Value(b)) => css::generic::eql(&**a, &**b),
            (Calc::Number(a), Calc::Number(b)) => css::generic::eql(a, b),
            (Calc::Sum { left: al, right: ar }, Calc::Sum { left: bl, right: br }) => {
                al.eql(bl) && ar.eql(br)
            }
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

    fn mul_value_f32(lhs: V, rhs: f32) -> V {
        // TODO(port): comptime type switch — Zig: `f32 => lhs * rhs, else => lhs.mulF32(...)`.
        // Needs trait method `V::mul_f32(self, f32) -> V` with f32 specialization.
        css::generic::mul_f32(lhs, rhs)
    }

    // TODO: addValueOwned
    pub fn add_value(lhs: V, rhs: V) -> V {
        // TODO(port): comptime type switch — Zig: `f32 => lhs + rhs, else => lhs.addInternal(...)`.
        // Needs trait method `V::add_internal(self, V) -> V` with f32 specialization.
        css::generic::add_internal(lhs, rhs)
    }

    // TODO: intoValueOwned
    pub fn into_value(self) -> CssResult<V> {
        // TODO(port): comptime type switch on V (Angle / CSSNumber / Length / Percentage /
        // Time / DimensionPercentage<LengthValue> / DimensionPercentage<Angle>). This must
        // become a trait method `V::from_calc(Calc<V>) -> CssResult<V>` implemented per-type.
        // The Zig body is preserved here as a reference for Phase B:
        //
        //   Angle      => .value -> *v, else -> err "angle value"
        //   CSSNumber  => .value -> *v, .number -> n, else -> err "number value"
        //   Length     => Length { .calc = Box::new(self) }
        //   Percentage => .value -> *v, else -> Percentage { v: NaN }
        //   Time       => .value -> *v, else -> err "time value"
        //   DimensionPercentage<LengthValue> => DimensionPercentage::Calc(Box::new(self))
        //   DimensionPercentage<Angle>       => DimensionPercentage::Calc(Box::new(self))
        //
        css::generic::calc_into_value(self)
    }

    pub fn into_calc(val: V) -> Self {
        // TODO(port): comptime type switch — Zig: `f32 => .{ .value = box(val) }, else => val.intoCalc()`.
        // Needs trait method `V::into_calc(self) -> Calc<V>` with f32 specialization.
        css::generic::into_calc(val)
    }

    // TODO: change to addOwned()
    pub fn add(self, rhs: Self) -> CssResult<Self> {
        if let (Calc::Value(a), Calc::Value(b)) = (&self, &rhs) {
            // PERF: we can reuse the allocation here
            // PORT NOTE: reshaped for borrowck — clone out of boxes then drop originals.
            let (a, b) = match (self, rhs) {
                (Calc::Value(a), Calc::Value(b)) => (*a, *b),
                _ => unreachable!(),
            };
            return CssResult::Ok(Self::into_calc(Self::add_value(a, b)));
        }
        if let (Calc::Number(a), Calc::Number(b)) = (&self, &rhs) {
            return CssResult::Ok(Calc::Number(a + b));
        }
        if matches!(self, Calc::Value(_)) {
            // PERF: we can reuse the allocation here
            let a = match self {
                Calc::Value(a) => *a,
                _ => unreachable!(),
            };
            let rhs_value = match rhs.into_value() {
                CssResult::Ok(v) => v,
                CssResult::Err(e) => return CssResult::Err(e),
            };
            return CssResult::Ok(Self::into_calc(Self::add_value(a, rhs_value)));
        }
        if matches!(rhs, Calc::Value(_)) {
            // PERF: we can reuse the allocation here
            let b = match rhs {
                Calc::Value(b) => *b,
                _ => unreachable!(),
            };
            let this_value = match self.into_value() {
                CssResult::Ok(v) => v,
                CssResult::Err(e) => return CssResult::Err(e),
            };
            return CssResult::Ok(Self::into_calc(Self::add_value(this_value, b)));
        }
        if matches!(self, Calc::Function(_)) || matches!(rhs, Calc::Function(_)) {
            return CssResult::Ok(Calc::Sum {
                left: Box::new(self),
                right: Box::new(rhs),
            });
        }
        let this_value = match self.into_value() {
            CssResult::Ok(v) => v,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        let rhs_value = match rhs.into_value() {
            CssResult::Ok(v) => v,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        CssResult::Ok(Self::into_calc(Self::add_value(this_value, rhs_value)))
    }

    // TODO: users of this and `parseWith` don't need the pointer and often throwaway heap allocated values immediately
    // use temp allocator or something?
    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        fn parse_with_fn<V>(_: (), _: &[u8]) -> Option<Calc<V>> {
            None
        }
        Self::parse_with(input, (), parse_with_fn::<V>)
    }

    pub fn parse_with<C: Copy>(
        input: &mut css::Parser,
        ctx: C,
        parse_ident: fn(C, &[u8]) -> Option<Self>,
    ) -> CssResult<Self> {
        let location = input.current_source_location();
        let f = match input.expect_function() {
            CssResult::Ok(v) => v,
            CssResult::Err(e) => return CssResult::Err(e),
        };

        let Some(unit) = CalcUnit::get_any_case(f) else {
            return CssResult::Err(location.new_unexpected_token_error(css::Token::Ident(f)));
        };

        // PORT NOTE: Zig used explicit `Closure` structs because Zig lacks closures.
        // Rust closures capture `ctx` + `parse_ident` directly.
        match unit {
            CalcUnit::Calc => {
                let calc = match input
                    .parse_nested_block(|i| Self::parse_sum(i, ctx, parse_ident))
                {
                    CssResult::Ok(vv) => vv,
                    CssResult::Err(e) => return CssResult::Err(e),
                };
                if matches!(calc, Calc::Value(_) | Calc::Number(_)) {
                    return CssResult::Ok(calc);
                }
                CssResult::Ok(Calc::Function(Box::new(MathFunction::Calc(calc))))
            }
            CalcUnit::Min => {
                let mut reduced = match input.parse_nested_block(|i| {
                    i.parse_comma_separated_with_ctx(|i| Self::parse_sum(i, ctx, parse_ident))
                }) {
                    CssResult::Ok(vv) => vv,
                    CssResult::Err(e) => return CssResult::Err(e),
                };
                // PERF(alloc): i don't like this additional allocation
                // can we use stack fallback here if the common case is that there will be 1 argument?
                Self::reduce_args(&mut reduced, Ordering::Less);
                if reduced.len() == 1 {
                    return CssResult::Ok(reduced.swap_remove(0));
                }
                CssResult::Ok(Calc::Function(Box::new(MathFunction::Min(reduced))))
            }
            CalcUnit::Max => {
                let mut reduced = match input.parse_nested_block(|i| {
                    i.parse_comma_separated_with_ctx(|i| Self::parse_sum(i, ctx, parse_ident))
                }) {
                    CssResult::Ok(vv) => vv,
                    CssResult::Err(e) => return CssResult::Err(e),
                };
                // PERF: i don't like this additional allocation
                Self::reduce_args(&mut reduced, Ordering::Greater);
                if reduced.len() == 1 {
                    return CssResult::Ok(reduced.remove(0));
                }
                CssResult::Ok(Calc::Function(Box::new(MathFunction::Max(reduced))))
            }
            CalcUnit::Clamp => {
                let (mut min, mut center, mut max) = match input.parse_nested_block(|i| {
                    let parse_ident_wrapper = |ident: &[u8]| parse_ident(ctx, ident);
                    let _ = parse_ident_wrapper; // PORT NOTE: Zig wrapped ctx; Rust captures directly
                    let min = match Self::parse_sum(i, ctx, parse_ident) {
                        CssResult::Ok(vv) => vv,
                        CssResult::Err(e) => return CssResult::Err(e),
                    };
                    if let Some(e) = i.expect_comma().as_err() {
                        return CssResult::Err(e);
                    }
                    let center = match Self::parse_sum(i, ctx, parse_ident) {
                        CssResult::Ok(vv) => vv,
                        CssResult::Err(e) => return CssResult::Err(e),
                    };
                    if let Some(e) = i.expect_comma().as_err() {
                        return CssResult::Err(e);
                    }
                    let max = match Self::parse_sum(i, ctx, parse_ident) {
                        CssResult::Ok(vv) => vv,
                        CssResult::Err(e) => return CssResult::Err(e),
                    };
                    CssResult::Ok((Some(min), center, Some(max)))
                }) {
                    CssResult::Ok(vv) => vv,
                    CssResult::Err(e) => return CssResult::Err(e),
                };

                // According to the spec, the minimum should "win" over the maximum if they are in the wrong order.
                let cmp = if let (Some(mx), Calc::Value(cv)) = (&max, &center) {
                    if let Calc::Value(mv) = mx {
                        css::generic::partial_cmp(&**cv, &**mv)
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

                let switch_val: u8 =
                    ((min.is_some() as u8) << 1) | (min.is_some() as u8);
                // TODO(port): Zig original has a likely bug — both bits derive from `min != null`.
                // Ported faithfully; Phase B should verify intended `(min, max)` packing.
                CssResult::Ok(match switch_val {
                    0b00 => center,
                    0b10 => Calc::Function(Box::new(MathFunction::Max(arr2(
                        min.unwrap(),
                        center,
                    )))),
                    0b01 => Calc::Function(Box::new(MathFunction::Min(arr2(
                        max.unwrap(),
                        center,
                    )))),
                    0b11 => Calc::Function(Box::new(MathFunction::Clamp {
                        min: min.unwrap(),
                        center,
                        max: max.unwrap(),
                    })),
                    _ => unreachable!(),
                })
            }
            CalcUnit::Round => input.parse_nested_block(|i| {
                let strategy = if let Some(s) = i.try_parse(RoundingStrategy::parse).as_value() {
                    if let Some(e) = i.expect_comma().as_err() {
                        return CssResult::Err(e);
                    }
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
                        // TODO(port): Zig `@mod(a, b)` (floored, sign of divisor) vs CSS `rem()`
                        // (truncated, sign of dividend). Ported as Rust `%` (truncated) — verify.
                        a % b
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
                let res = match Self::parse_atan2(i, ctx, parse_ident) {
                    CssResult::Ok(v) => v,
                    CssResult::Err(e) => return CssResult::Err(e),
                };
                if let Some(v) = css::generic::try_from_angle::<V>(res) {
                    return CssResult::Ok(Calc::Value(Box::new(v)));
                }
                CssResult::Err(i.new_custom_error(css::ParserError::InvalidValue))
            }),
            CalcUnit::Pow => input.parse_nested_block(|i| {
                let a = match Self::parse_numeric(i, ctx, parse_ident) {
                    CssResult::Ok(vv) => vv,
                    CssResult::Err(e) => return CssResult::Err(e),
                };
                if let Some(e) = i.expect_comma().as_err() {
                    return CssResult::Err(e);
                }
                let b = match Self::parse_numeric(i, ctx, parse_ident) {
                    CssResult::Ok(vv) => vv,
                    CssResult::Err(e) => return CssResult::Err(e),
                };
                CssResult::Ok(Calc::Number(bun_core::powf(a, b)))
            }),
            CalcUnit::Log => input.parse_nested_block(|i| {
                let value = match Self::parse_numeric(i, ctx, parse_ident) {
                    CssResult::Ok(vv) => vv,
                    CssResult::Err(e) => return CssResult::Err(e),
                };
                if i.try_parse(css::Parser::expect_comma).is_ok() {
                    let base = match Self::parse_numeric(i, ctx, parse_ident) {
                        CssResult::Ok(vv) => vv,
                        CssResult::Err(e) => return CssResult::Err(e),
                    };
                    return CssResult::Ok(Calc::Number(value.log(base)));
                }
                CssResult::Ok(Calc::Number(value.ln()))
            }),
            CalcUnit::Sqrt => Self::parse_numeric_fn(input, NumericFnOp::Sqrt, ctx, parse_ident),
            CalcUnit::Exp => Self::parse_numeric_fn(input, NumericFnOp::Exp, ctx, parse_ident),
            CalcUnit::Hypot => input.parse_nested_block(|i| {
                let mut args = match i
                    .parse_comma_separated_with_ctx(|i| Self::parse_sum(i, ctx, parse_ident))
                {
                    CssResult::Ok(v) => v,
                    CssResult::Err(e) => return CssResult::Err(e),
                };
                let val = match Self::parse_hypot(&mut args) {
                    CssResult::Ok(vv) => vv,
                    CssResult::Err(e) => return CssResult::Err(e),
                };
                if let Some(v) = val {
                    return CssResult::Ok(v);
                }
                CssResult::Ok(Calc::Function(Box::new(MathFunction::Hypot(args))))
            }),
            CalcUnit::Abs => input.parse_nested_block(|i| {
                let v = match Self::parse_sum(i, ctx, parse_ident) {
                    CssResult::Ok(vv) => vv,
                    CssResult::Err(e) => return CssResult::Err(e),
                };
                CssResult::Ok(if let Some(vv) = Self::apply_map(&v, absf) {
                    vv
                } else {
                    Calc::Function(Box::new(MathFunction::Abs(v)))
                })
            }),
            CalcUnit::Sign => input.parse_nested_block(|i| {
                let v = match Self::parse_sum(i, ctx, parse_ident) {
                    CssResult::Ok(vv) => vv,
                    CssResult::Err(e) => return CssResult::Err(e),
                };
                match &v {
                    Calc::Number(n) => return CssResult::Ok(Calc::Number(std_math_sign(*n))),
                    Calc::Value(v2) => {
                        // First map so we ignore percentages, which must be resolved to their
                        // computed value in order to determine the sign.
                        if let Some(new_v) = css::generic::try_map(&**v2, std_math_sign) {
                            // sign() alwasy resolves to a number.
                            return CssResult::Ok(Calc::Number(
                                css::generic::try_sign(&new_v)
                                    .unwrap_or_else(|| panic!("sign() always resolves to a number.")),
                            ));
                        }
                    }
                    _ => {}
                }
                CssResult::Ok(Calc::Function(Box::new(MathFunction::Sign(v))))
            }),
        }
    }

    pub fn parse_numeric_fn<C: Copy>(
        input: &mut css::Parser,
        op: NumericFnOp,
        ctx: C,
        parse_ident: fn(C, &[u8]) -> Option<Self>,
    ) -> CssResult<Self> {
        // PERF(port): was comptime monomorphization on `op` — profile in Phase B.
        input.parse_nested_block(|i| {
            let v = match Self::parse_numeric(i, ctx, parse_ident) {
                CssResult::Ok(v) => v,
                CssResult::Err(e) => return CssResult::Err(e),
            };
            CssResult::Ok(Calc::Number(match op {
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
        parse_ident: fn(C, &[u8]) -> Option<Self>,
    ) -> CssResult<Self> {
        let a = match Self::parse_sum(input, ctx_for_parse_ident, parse_ident) {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        if let Some(e) = input.expect_comma().as_err() {
            return CssResult::Err(e);
        }
        let b = match Self::parse_sum(input, ctx_for_parse_ident, parse_ident) {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };

        let val = Self::apply_op(&a, &b, ctx_for_op_and_fallback, op).unwrap_or_else(|| {
            Calc::Function(Box::new(fallback(ctx_for_op_and_fallback, a, b)))
        });

        CssResult::Ok(val)
    }

    pub fn parse_sum<C: Copy>(
        input: &mut css::Parser,
        ctx: C,
        parse_ident: fn(C, &[u8]) -> Option<Self>,
    ) -> CssResult<Self> {
        let mut cur = match Self::parse_product(input, ctx, parse_ident) {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        loop {
            let start = input.state();
            let tok = match input.next_including_whitespace() {
                CssResult::Ok(vv) => vv,
                CssResult::Err(_) => {
                    input.reset(&start);
                    break;
                }
            };

            if matches!(tok, css::Token::Whitespace(_)) {
                if input.is_exhausted() {
                    break; // allow trailing whitespace
                }
                let next_tok = match input.next() {
                    CssResult::Ok(vv) => vv,
                    CssResult::Err(e) => return CssResult::Err(e),
                };
                if matches!(next_tok, css::Token::Delim('+')) {
                    let next = match Self::parse_product(input, ctx, parse_ident) {
                        CssResult::Ok(vv) => vv,
                        CssResult::Err(e) => return CssResult::Err(e),
                    };
                    cur = match cur.add(next) {
                        CssResult::Ok(v) => v,
                        CssResult::Err(e) => return CssResult::Err(e),
                    };
                } else if matches!(next_tok, css::Token::Delim('-')) {
                    let mut rhs = match Self::parse_product(input, ctx, parse_ident) {
                        CssResult::Ok(vv) => vv,
                        CssResult::Err(e) => return CssResult::Err(e),
                    };
                    rhs = rhs.mul_f32(-1.0);
                    cur = match cur.add(rhs) {
                        CssResult::Ok(v) => v,
                        CssResult::Err(e) => return CssResult::Err(e),
                    };
                } else {
                    return CssResult::Err(input.new_unexpected_token_error(next_tok.clone()));
                }
                continue;
            }
            input.reset(&start);
            break;
        }

        CssResult::Ok(cur)
    }

    pub fn parse_product<C: Copy>(
        input: &mut css::Parser,
        ctx: C,
        parse_ident: fn(C, &[u8]) -> Option<Self>,
    ) -> CssResult<Self> {
        let mut node = match Self::parse_value(input, ctx, parse_ident) {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        loop {
            let start = input.state();
            let tok = match input.next() {
                CssResult::Ok(vv) => vv,
                CssResult::Err(_) => {
                    input.reset(&start);
                    break;
                }
            };

            if matches!(tok, css::Token::Delim('*')) {
                // At least one of the operands must be a number.
                let rhs = match Self::parse_value(input, ctx, parse_ident) {
                    CssResult::Ok(vv) => vv,
                    CssResult::Err(e) => return CssResult::Err(e),
                };
                if let Calc::Number(n) = rhs {
                    node = node.mul_f32(n);
                } else if let Calc::Number(val) = node {
                    node = rhs;
                    node = node.mul_f32(val);
                } else {
                    return CssResult::Err(
                        input.new_unexpected_token_error(css::Token::Delim('*')),
                    );
                }
            } else if matches!(tok, css::Token::Delim('/')) {
                let rhs = match Self::parse_value(input, ctx, parse_ident) {
                    CssResult::Ok(vv) => vv,
                    CssResult::Err(e) => return CssResult::Err(e),
                };
                if let Calc::Number(val) = rhs {
                    if val != 0.0 {
                        node = node.mul_f32(1.0 / val);
                        continue;
                    }
                }
                return CssResult::Err(input.new_custom_error(css::ParserError::InvalidValue));
            } else {
                input.reset(&start);
                break;
            }
        }
        CssResult::Ok(node)
    }

    pub fn parse_value<C: Copy>(
        input: &mut css::Parser,
        ctx: C,
        parse_ident: fn(C, &[u8]) -> Option<Self>,
    ) -> CssResult<Self> {
        // Parse nested calc() and other math functions.
        if let Some(calc) = input.try_parse(Self::parse).as_value() {
            match calc {
                Calc::Function(f) => {
                    return match *f {
                        MathFunction::Calc(c) => CssResult::Ok(c),
                        other => CssResult::Ok(Calc::Function(Box::new(other))),
                    };
                }
                other => return CssResult::Ok(other),
            }
        }

        if input.try_parse(css::Parser::expect_parenthesis_block).is_ok() {
            return input.parse_nested_block(|i| Self::parse_sum(i, ctx, parse_ident));
        }

        if let Some(num) = input.try_parse(css::Parser::expect_number).as_value() {
            return CssResult::Ok(Calc::Number(num));
        }

        if let Some(constant) = input.try_parse(Constant::parse).as_value() {
            return CssResult::Ok(Calc::Number(constant.into_f32()));
        }

        let location = input.current_source_location();
        if let Some(ident) = input.try_parse(css::Parser::expect_ident).as_value() {
            if let Some(c) = parse_ident(ctx, ident) {
                return CssResult::Ok(c);
            }
            return CssResult::Err(location.new_unexpected_token_error(css::Token::Ident(ident)));
        }

        let value = match input.try_parse(css::generic::parse_for::<V>) {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        CssResult::Ok(Calc::Value(Box::new(value)))
    }

    pub fn parse_trig<C: Copy>(
        input: &mut css::Parser,
        trig_fn_kind: TrigFnKind,
        to_angle: bool,
        ctx: C,
        parse_ident: fn(C, &[u8]) -> Option<Self>,
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
            let v = match Calc::<Angle>::parse_sum(i, (), parse_ident_fn) {
                CssResult::Ok(vv) => vv,
                CssResult::Err(e) => return CssResult::Err(e),
            };

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
                return CssResult::Err(i.new_custom_error(css::ParserError::InvalidValue));
            };

            if to_angle && !rad.is_nan() {
                if let Some(val) = css::generic::try_from_angle::<V>(Angle::Rad(rad)) {
                    return CssResult::Ok(Calc::Value(Box::new(val)));
                }
                return CssResult::Err(i.new_custom_error(css::ParserError::InvalidValue));
            } else {
                return CssResult::Ok(Calc::Number(rad));
            }
        })
    }

    pub fn parse_ident_none<C, Value>(_: C, _: &[u8]) -> Option<Calc<Value>> {
        None
    }

    pub fn parse_atan2<C: Copy>(
        input: &mut css::Parser,
        ctx: C,
        parse_ident: fn(C, &[u8]) -> Option<Self>,
    ) -> CssResult<Angle> {
        // atan2 supports arguments of any <number>, <dimension>, or <percentage>, even ones that wouldn't
        // normally be supported by V. The only requirement is that the arguments be of the same type.
        // Try parsing with each type, and return the first one that parses successfully.
        if let Some(v) = try_parse_atan2_args::<C, Length>(input, ctx).as_value() {
            return CssResult::Ok(v);
        }
        if let Some(v) = try_parse_atan2_args::<C, Percentage>(input, ctx).as_value() {
            return CssResult::Ok(v);
        }
        if let Some(v) = try_parse_atan2_args::<C, Angle>(input, ctx).as_value() {
            return CssResult::Ok(v);
        }
        if let Some(v) = try_parse_atan2_args::<C, Time>(input, ctx).as_value() {
            return CssResult::Ok(v);
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
        parse_ident: fn(C, &[u8]) -> Option<Self>,
    ) -> CssResult<Angle> {
        let a = match Self::parse_sum(input, ctx, parse_ident) {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        if let Some(e) = input.expect_comma().as_err() {
            return CssResult::Err(e);
        }
        let b = match Self::parse_sum(input, ctx, parse_ident) {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };

        if let (Calc::Value(av), Calc::Value(bv)) = (&a, &b) {
            if let Some(v) =
                css::generic::try_op_to::<V, Angle>(&**av, &**bv, (), |_, x, y| Angle::Rad(x.atan2(y)))
            {
                return CssResult::Ok(v);
            }
        } else if let (Calc::Number(an), Calc::Number(bn)) = (&a, &b) {
            return CssResult::Ok(Angle::Rad(an.atan2(*bn)));
        } else {
            // doo nothing
        }

        // We don't have a way to represent arguments that aren't angles, so just error.
        // This will fall back to an unparsed property, leaving the atan2() function intact.
        CssResult::Err(input.new_custom_error(css::ParserError::InvalidValue))
    }

    pub fn parse_numeric<C: Copy>(
        input: &mut css::Parser,
        ctx: C,
        parse_ident: fn(C, &[u8]) -> Option<Self>,
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
        let v: Calc<CSSNumber> = match Calc::<CSSNumber>::parse_sum(input, ctx, parse_ident_fn) {
            CssResult::Ok(v) => v,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        let val = match v {
            Calc::Number(n) => n,
            Calc::Value(v) => *v,
            _ => return CssResult::Err(input.new_custom_error(css::ParserError::InvalidValue)),
        };
        CssResult::Ok(val)
    }

    pub fn parse_hypot(args: &mut Vec<Self>) -> CssResult<Option<Self>> {
        if args.len() == 1 {
            let v = core::mem::replace(&mut args[0], Calc::Number(0.0));
            return CssResult::Ok(Some(v));
        }

        if args.len() == 2 {
            return CssResult::Ok(Self::apply_op(&args[0], &args[1], (), |_, a, b| hypot((), a, b)));
        }

        let mut i: usize = 0;
        let Some(first) = Self::apply_map(&args[0], powi2) else {
            return CssResult::Ok(None);
        };
        i += 1;
        let mut errored = false;
        let mut sum = first;
        for arg in &args[i..] {
            let Some(next) = Self::apply_op(&sum, arg, (), |_, a, b| a + bun_core::powf(b, 2.0))
            else {
                errored = true;
                break;
            };
            sum = next;
        }

        if errored {
            return CssResult::Ok(None);
        }

        CssResult::Ok(Self::apply_map(&sum, sqrtf32))
    }

    pub fn apply_op<OC: Copy>(
        a: &Self,
        b: &Self,
        ctx: OC,
        op: fn(OC, f32, f32) -> f32,
    ) -> Option<Self> {
        if let (Calc::Value(av), Calc::Value(bv)) = (a, b) {
            if let Some(v) = css::generic::try_op(&**av, &**bv, ctx, op) {
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
                if let Some(new_v) = css::generic::try_map(&**v, op) {
                    return Some(Calc::Value(Box::new(new_v)));
                }
            }
            _ => {}
        }
        None
    }

    pub fn to_css(&self, dest: &mut css::Printer) -> Result<(), css::PrintErr> {
        let was_in_calc = dest.in_calc;
        dest.in_calc = true;

        let res = self.to_css_impl(dest);

        dest.in_calc = was_in_calc;
        res
    }

    pub fn to_css_impl(&self, dest: &mut css::Printer) -> Result<(), css::PrintErr>
    where
        V: Clone,
    {
        match self {
            Calc::Value(v) => css::generic::to_css(&**v, dest),
            Calc::Number(n) => CSSNumberFns::to_css(n, dest),
            Calc::Sum { left: a, right: b } => {
                a.to_css(dest)?;
                // White space is always required.
                if b.is_sign_negative() {
                    dest.write_str(" - ")?;
                    let b2 = b.deep_clone().mul_f32(-1.0);
                    b2.to_css(dest)?;
                } else {
                    dest.write_str(" + ")?;
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
                    dest.delim('/', true)?;
                    CSSNumberFns::to_css(&div, dest)?;
                } else {
                    CSSNumberFns::to_css(&num, dest)?;
                    dest.delim('*', true)?;
                    calc.to_css(dest)?;
                }
                Ok(())
            }
            Calc::Function(f) => f.to_css(dest),
        }
    }

    pub fn try_sign(&self) -> Option<f32> {
        match self {
            Calc::Value(v) => {
                // TODO(port): comptime type switch — Zig: `f32 => signF32(v), else => v.trySign()`.
                css::generic::try_sign(&**v)
            }
            Calc::Number(n) => Some(css::signfns::sign_f32(*n)),
            _ => None,
        }
    }

    pub fn is_sign_negative(&self) -> bool {
        let Some(s) = self.try_sign() else {
            return false;
        };
        css::signfns::is_sign_negative(s)
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
                MathFunction::Calc(c) => Calc::Function(Box::new(MathFunction::Calc(
                    c.mul_f32(other),
                ))),
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
    fn reduce_args(args: &mut Vec<Self>, order: Ordering)
    where
        V: PartialOrd,
    {
        // Reduces the arguments of a min() or max() expression, combining compatible values.
        // e.g. min(1px, 1em, 2px, 3in) => min(1px, 1em)
        let mut reduced: Vec<Self> = Vec::new();

        for arg in args.iter_mut() {
            let mut found: Option<Option<usize>> = None;
            if let Calc::Value(val) = &*arg {
                for (idx, b) in reduced.iter().enumerate() {
                    if let Calc::Value(v) = b {
                        let result = css::generic::partial_cmp(&**val, &**v);
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

        // Zig: css.deepDeinit(This, allocator, args) — Rust: Drop on replace handles it.
        *args = reduced;
    }

    pub fn is_compatible(&self, browsers: css::targets::Browsers) -> bool {
        match self {
            Calc::Sum { left, right } => {
                left.is_compatible(browsers) && right.is_compatible(browsers)
            }
            Calc::Product { expression, .. } => expression.is_compatible(browsers),
            Calc::Function(f) => f.is_compatible(browsers),
            Calc::Value(v) => css::generic::is_compatible(&**v, browsers),
            Calc::Number(_) => true,
        }
    }
}

#[inline]
fn try_parse_atan2_args<C: Copy, Value>(
    input: &mut css::Parser,
    ctx: C,
) -> CssResult<Angle> {
    let func = Calc::<Value>::parse_ident_none::<C, Value>;
    input.try_parse_impl(|i| Calc::<Value>::parse_atan2_args(i, ctx, func))
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
    Min(Vec<Calc<V>>),
    /// The `max()` function.
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
    Rem {
        dividend: Calc<V>,
        divisor: Calc<V>,
    },
    /// The `mod()` function.
    Mod {
        dividend: Calc<V>,
        divisor: Calc<V>,
    },
    /// The `abs()` function.
    Abs(Calc<V>),
    /// The `sign()` function.
    Sign(Calc<V>),
    /// The `hypot()` function.
    Hypot(Vec<Calc<V>>),
}

impl<V> MathFunction<V> {
    pub fn eql(&self, other: &Self) -> bool
    where
        V: PartialEq,
    {
        match (self, other) {
            (MathFunction::Calc(a), MathFunction::Calc(b)) => a.eql(b),
            (MathFunction::Min(a), MathFunction::Min(b)) => css::generic::eql_list(a, b),
            (MathFunction::Max(a), MathFunction::Max(b)) => css::generic::eql_list(a, b),
            (
                MathFunction::Clamp { min: a0, center: a1, max: a2 },
                MathFunction::Clamp { min: b0, center: b1, max: b2 },
            ) => a0.eql(b0) && a1.eql(b1) && a2.eql(b2),
            (
                MathFunction::Round { strategy: as_, value: av, interval: ai },
                MathFunction::Round { strategy: bs, value: bv, interval: bi },
            ) => as_ == bs && av.eql(bv) && ai.eql(bi),
            (
                MathFunction::Rem { dividend: ad, divisor: av },
                MathFunction::Rem { dividend: bd, divisor: bv },
            ) => ad.eql(bd) && av.eql(bv),
            (
                MathFunction::Mod { dividend: ad, divisor: av },
                MathFunction::Mod { dividend: bd, divisor: bv },
            ) => ad.eql(bd) && av.eql(bv),
            (MathFunction::Abs(a), MathFunction::Abs(b)) => a.eql(b),
            (MathFunction::Sign(a), MathFunction::Sign(b)) => a.eql(b),
            (MathFunction::Hypot(a), MathFunction::Hypot(b)) => css::generic::eql_list(a, b),
            _ => false,
        }
    }

    pub fn deep_clone(&self) -> Self
    where
        V: Clone,
    {
        match self {
            MathFunction::Calc(calc) => MathFunction::Calc(calc.deep_clone()),
            MathFunction::Min(min) => MathFunction::Min(css::deep_clone(min)),
            MathFunction::Max(max) => MathFunction::Max(css::deep_clone(max)),
            MathFunction::Clamp { min, center, max } => MathFunction::Clamp {
                min: min.deep_clone(),
                center: center.deep_clone(),
                max: max.deep_clone(),
            },
            MathFunction::Round { strategy, value, interval } => MathFunction::Round {
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
            MathFunction::Hypot(hyp) => MathFunction::Hypot(css::deep_clone(hyp)),
        }
    }

    // Zig `deinit` only freed owned Vec/Calc fields → handled by Drop. No explicit impl.

    pub fn to_css(&self, dest: &mut css::Printer) -> Result<(), css::PrintErr> {
        match self {
            MathFunction::Calc(calc) => {
                dest.write_str("calc(")?;
                calc.to_css(dest)?;
                dest.write_char(')')
            }
            MathFunction::Min(args) => {
                dest.write_str("min(")?;
                let mut first = true;
                for arg in args {
                    if first {
                        first = false;
                    } else {
                        dest.delim(',', false)?;
                    }
                    arg.to_css(dest)?;
                }
                dest.write_char(')')
            }
            MathFunction::Max(args) => {
                dest.write_str("max(")?;
                let mut first = true;
                for arg in args {
                    if first {
                        first = false;
                    } else {
                        dest.delim(',', false)?;
                    }
                    arg.to_css(dest)?;
                }
                dest.write_char(')')
            }
            MathFunction::Clamp { min, center, max } => {
                dest.write_str("clamp(")?;
                min.to_css(dest)?;
                dest.delim(',', false)?;
                center.to_css(dest)?;
                dest.delim(',', false)?;
                max.to_css(dest)?;
                dest.write_char(')')
            }
            MathFunction::Round { strategy, value, interval } => {
                dest.write_str("round(")?;
                if *strategy != RoundingStrategy::default() {
                    strategy.to_css(dest)?;
                    dest.delim(',', false)?;
                }
                value.to_css(dest)?;
                dest.delim(',', false)?;
                interval.to_css(dest)?;
                dest.write_char(')')
            }
            MathFunction::Rem { dividend, divisor } => {
                dest.write_str("rem(")?;
                dividend.to_css(dest)?;
                dest.delim(',', false)?;
                divisor.to_css(dest)?;
                dest.write_char(')')
            }
            MathFunction::Mod { dividend, divisor } => {
                dest.write_str("mod(")?;
                dividend.to_css(dest)?;
                dest.delim(',', false)?;
                divisor.to_css(dest)?;
                dest.write_char(')')
            }
            MathFunction::Abs(v) => {
                dest.write_str("abs(")?;
                v.to_css(dest)?;
                dest.write_char(')')
            }
            MathFunction::Sign(v) => {
                dest.write_str("sign(")?;
                v.to_css(dest)?;
                dest.write_char(')')
            }
            MathFunction::Hypot(args) => {
                dest.write_str("hypot(")?;
                let mut first = true;
                for arg in args {
                    if first {
                        first = false;
                    } else {
                        dest.delim(',', false)?;
                    }
                    arg.to_css(dest)?;
                }
                dest.write_char(')')
            }
        }
    }

    pub fn is_compatible(&self, browsers: css::targets::Browsers) -> bool {
        use css::compat::Feature as F;
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
            MathFunction::Round { value, interval, .. } => {
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
#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
pub enum RoundingStrategy {
    /// Round to the nearest integer.
    #[strum(serialize = "nearest")]
    Nearest,
    /// Round up (ceil).
    #[strum(serialize = "up")]
    Up,
    /// Round down (floor).
    #[strum(serialize = "down")]
    Down,
    /// Round toward zero (truncate).
    #[strum(serialize = "to-zero")]
    ToZero,
}

impl RoundingStrategy {
    pub fn as_str(&self) -> &'static [u8] {
        css::enum_property_util::as_str(self)
    }

    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        css::enum_property_util::parse(input)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        css::enum_property_util::to_css(self, dest)
    }
}

impl Default for RoundingStrategy {
    fn default() -> Self {
        RoundingStrategy::Nearest
    }
}

fn arr2<T>(a: T, b: T) -> Vec<T> {
    // PERF(port): was arena-backed ArrayList
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
    bun_core::powf(v, 2.0)
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
#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
pub enum Constant {
    /// The base of the natural logarithm
    #[strum(serialize = "e")]
    E,
    /// The ratio of a circle's circumference to its diameter
    #[strum(serialize = "pi")]
    Pi,
    /// infinity
    #[strum(serialize = "infinity")]
    Infinity,
    /// -infinity
    #[strum(serialize = "-infinity")]
    NegInfinity,
    /// Not a number.
    #[strum(serialize = "nan")]
    Nan,
}

impl Constant {
    pub fn as_str(&self) -> &'static [u8] {
        css::enum_property_util::as_str(self)
    }

    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        css::enum_property_util::parse(input)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        css::enum_property_util::to_css(self, dest)
    }

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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/calc.zig (1892 lines)
//   confidence: medium
//   todos:      15
//   notes:      comptime `switch (V)` dispatch (intoValue/addValue/mulValueF32/intoCalc/trySign) needs a `CalcValue` trait in Phase B; closure-struct → Rust-closure reshape changes parse_ident plumbing (fn-pointer vs captured-ctx) and won't typecheck as-is; LIFETIMES.tsv chose Box over arena so allocator params dropped — verify CSS arena interaction; preserved likely Zig bug at clamp switch_val packing.
// ──────────────────────────────────────────────────────────────────────────
