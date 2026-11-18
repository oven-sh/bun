//! The values of constant expressions.

use super::lexer::Known;
use super::tree::{Scalar, Type};
use crate::webgl::pixels::{from_half, to_half};

pub type Operand<'a> = (Type, &'a [u32]);

fn float(bits: u32) -> f32 {
    f32::from_bits(bits)
}

pub fn convert(bits: u32, from: Scalar, to: Scalar) -> u32 {
    match (from, to) {
        (Scalar::Float, Scalar::Float) => bits,
        (Scalar::Float, Scalar::Int) => float(bits) as i32 as u32,
        (Scalar::Float, Scalar::Uint) if float(bits) < 0. => float(bits) as i32 as u32,
        (Scalar::Float, Scalar::Uint) => float(bits) as u32,
        (Scalar::Float, Scalar::Bool) => (float(bits) != 0.).into(),
        (Scalar::Int, Scalar::Float) => (bits as i32 as f32).to_bits(),
        (_, Scalar::Float) => (bits as f32).to_bits(),
        (_, Scalar::Bool) => (bits != 0).into(),
        _ => bits,
    }
}

/// Of a scalar, a vector or a matrix.
pub fn construct(of: Type, to: Scalar, arguments: &[Operand]) -> Vec<u32> {
    let (columns, rows) = (usize::from(of.columns), usize::from(of.rows));
    let places = (0..columns).flat_map(|column| (0..rows).map(move |row| (column, row)));
    let mut converted = arguments.iter().flat_map(|(from, values)| {
        values
            .iter()
            .map(|it| convert(*it, from.scalar().unwrap_or(to), to))
    });
    match *arguments {
        [(from, _)] if from.is_scalar() => {
            let value = converted.next().unwrap_or(0);
            places
                .map(|(column, row)| {
                    if columns == 1 || column == row {
                        value
                    } else {
                        0
                    }
                })
                .collect()
        }
        [(from, values)] if from.is_matrix() && of.is_matrix() => {
            let is_inside =
                |column, row| column < usize::from(from.columns) && row < usize::from(from.rows);
            places
                .map(|(column, row)| {
                    if is_inside(column, row) {
                        values[column * usize::from(from.rows) + row]
                    } else {
                        f32::from(column == row).to_bits()
                    }
                })
                .collect()
        }
        _ => converted.take(columns * rows).collect(),
    }
}

pub fn prefix(operator: Known, (of, values): Operand) -> Vec<u32> {
    let apply = |it: &u32| match operator {
        Known::Minus if of.scalar() == Some(Scalar::Float) => it ^ 1 << 31,
        Known::Minus => it.wrapping_neg(),
        Known::Not => it ^ 1,
        Known::Tilde => !it,
        _ => *it,
    };
    values.iter().map(apply).collect()
}

fn is_less(scalar: Option<Scalar>, a: u32, b: u32) -> bool {
    match scalar {
        Some(Scalar::Float) => float(a) < float(b),
        Some(Scalar::Int) => (a as i32) < b as i32,
        _ => a < b,
    }
}

pub fn is_equal(scalar: Option<Scalar>, a: u32, b: u32) -> bool {
    if scalar == Some(Scalar::Float) {
        float(a) == float(b)
    } else {
        a == b
    }
}

fn compare(operator: Known, scalar: Option<Scalar>, a: u32, b: u32) -> u32 {
    u32::from(match operator {
        Known::Less => is_less(scalar, a, b),
        Known::Greater => is_less(scalar, b, a),
        Known::LessEqual => is_less(scalar, a, b) || is_equal(scalar, a, b),
        Known::GreaterEqual => is_less(scalar, b, a) || is_equal(scalar, a, b),
        Known::Equal => is_equal(scalar, a, b),
        _ => !is_equal(scalar, a, b),
    })
}

fn arithmetic(operator: Known, scalar: Option<Scalar>, a: u32, b: u32) -> u32 {
    let is_signed = scalar == Some(Scalar::Int);
    match operator {
        Known::Less | Known::Greater | Known::LessEqual | Known::GreaterEqual => {
            compare(operator, scalar, a, b)
        }
        Known::Plus if scalar == Some(Scalar::Float) => (float(a) + float(b)).to_bits(),
        Known::Minus if scalar == Some(Scalar::Float) => (float(a) - float(b)).to_bits(),
        Known::Star if scalar == Some(Scalar::Float) => (float(a) * float(b)).to_bits(),
        Known::Slash if scalar == Some(Scalar::Float) => (float(a) / float(b)).to_bits(),
        Known::Plus => a.wrapping_add(b),
        Known::Minus => a.wrapping_sub(b),
        Known::Star => a.wrapping_mul(b),
        Known::Slash if is_signed => (a as i32).checked_div(b as i32).unwrap_or(i32::MAX) as u32,
        Known::Slash => a.checked_div(b).unwrap_or(u32::MAX),
        Known::Percent if is_signed => (a as i32).checked_rem(b as i32).unwrap_or(0) as u32,
        Known::Percent => a.checked_rem(b).unwrap_or(0),
        Known::ShiftLeft => a.checked_shl(b).unwrap_or(0),
        Known::ShiftRight if is_signed => (a as i32).checked_shr(b).unwrap_or(0) as u32,
        Known::ShiftRight => a.checked_shr(b).unwrap_or(0),
        Known::Ampersand | Known::And => a & b,
        Known::Bar | Known::Or => a | b,
        _ => a ^ b,
    }
}

fn dot(a: impl Iterator<Item = u32>, b: impl Iterator<Item = u32>) -> f32 {
    a.zip(b).map(|(a, b)| float(a) * float(b)).sum()
}

/// But for equality.
pub fn binary(operator: Known, (left, a): Operand, (right, b): Operand) -> Vec<u32> {
    if operator == Known::Star
        && (left.is_matrix() || right.is_matrix())
        && !left.is_scalar()
        && !right.is_scalar()
    {
        let rows = if left.is_matrix() {
            usize::from(left.rows)
        } else {
            1
        };
        let product = |column: &[u32]| {
            (0..rows)
                .map(|row| {
                    dot(
                        a[row..].iter().step_by(rows).copied(),
                        column.iter().copied(),
                    )
                    .to_bits()
                })
                .collect::<Vec<_>>()
        };
        return b.chunks(right.rows.into()).flat_map(product).collect();
    }
    (0..a.len().max(b.len()))
        .map(|at| arithmetic(operator, left.scalar(), a[at % a.len()], b[at % b.len()]))
        .collect()
}

fn without(matrix: &[f32], size: usize, column: usize, row: usize) -> Vec<f32> {
    (0..size * size)
        .filter(|it| it / size != column && it % size != row)
        .map(|it| matrix[it])
        .collect()
}

fn cofactor(matrix: &[f32], size: usize, column: usize, row: usize) -> f32 {
    determinant(&without(matrix, size, column, row), size - 1)
        * if (column + row).is_multiple_of(2) {
            1.
        } else {
            -1.
        }
}

fn determinant(matrix: &[f32], size: usize) -> f32 {
    if size == 1 {
        matrix[0]
    } else {
        (0..size)
            .map(|row| matrix[row] * cofactor(matrix, size, 0, row))
            .sum()
    }
}

fn of_one_float(name: &str) -> Option<fn(f32) -> f32> {
    Some(match name {
        "radians" => f32::to_radians,
        "degrees" => f32::to_degrees,
        "sin" => f32::sin,
        "cos" => f32::cos,
        "tan" => f32::tan,
        "asin" => f32::asin,
        "acos" => f32::acos,
        "atan" => f32::atan,
        "sinh" => f32::sinh,
        "cosh" => f32::cosh,
        "tanh" => f32::tanh,
        "asinh" => f32::asinh,
        "acosh" => f32::acosh,
        "atanh" => f32::atanh,
        "exp" => f32::exp,
        "log" => f32::ln,
        "exp2" => f32::exp2,
        "log2" => f32::log2,
        "sqrt" => f32::sqrt,
        "inversesqrt" => |it| 1. / it.sqrt(),
        "abs" => f32::abs,
        "sign" => |it| if it == 0. { 0. } else { it.signum() },
        "floor" => f32::floor,
        "ceil" => f32::ceil,
        "fract" => |it| it - it.floor(),
        "trunc" => f32::trunc,
        "round" => f32::round,
        "roundEven" => f32::round_ties_even,
        "dFdx" | "dFdy" | "fwidth" => |_| 0.,
        _ => return None,
    })
}

pub fn builtin(name: &str, arguments: &[Operand], result: Type) -> Option<Vec<u32>> {
    let (of, scalar, count) = (
        arguments[0].0,
        arguments[0].0.scalar(),
        result.components() as usize,
    );
    let bits = |argument: usize, at: usize| arguments[argument].1[at % arguments[argument].1.len()];
    let at = |argument: usize, at: usize| float(bits(argument, at));
    let all = |argument: usize| arguments[argument].1.iter().copied();
    let each = |make: &dyn Fn(usize) -> u32| Some((0..count).map(make).collect());
    let floats = |make: &dyn Fn(usize) -> f32| each(&|it| make(it).to_bits());
    let smaller = |a, b| if is_less(scalar, b, a) { b } else { a };
    let larger = |a, b| if is_less(scalar, a, b) { b } else { a };
    let relation = |operator| each(&|it| compare(operator, scalar, bits(0, it), bits(1, it)));
    let pack = |half: fn(f32) -> u16| {
        Some(vec![
            u32::from(half(at(0, 0))) | u32::from(half(at(0, 1))) << 16,
        ])
    };
    let unpack = |half: fn(u16) -> f32| floats(&|it| half((bits(0, 0) >> (16 * it)) as u16));
    let (matrix, size) = (
        || all(0).map(float).collect::<Vec<_>>(),
        usize::from(of.rows),
    );
    if let (Some(function), 1, Some(Scalar::Float)) = (of_one_float(name), arguments.len(), scalar)
    {
        return floats(&|it| function(at(0, it)));
    }
    match name {
        "abs" => each(&|it| (bits(0, it) as i32).wrapping_abs() as u32),
        "sign" => each(&|it| (bits(0, it) as i32).signum() as u32),
        "atan" => floats(&|it| at(0, it).atan2(at(1, it))),
        "pow" => floats(&|it| at(0, it).powf(at(1, it))),
        "mod" => floats(&|it| at(0, it) - at(1, it) * (at(0, it) / at(1, it)).floor()),
        "min" => each(&|it| smaller(bits(0, it), bits(1, it))),
        "max" => each(&|it| larger(bits(0, it), bits(1, it))),
        "clamp" => each(&|it| smaller(larger(bits(0, it), bits(1, it)), bits(2, it))),
        "mix" if arguments[2].0.scalar() == Some(Scalar::Bool) => {
            each(&|it| bits(bits(2, it) as usize, it))
        }
        "mix" => floats(&|it| at(0, it) * (1. - at(2, it)) + at(1, it) * at(2, it)),
        "step" => floats(&|it| if at(1, it) < at(0, it) { 0. } else { 1. }),
        "smoothstep" => floats(&|it| {
            let share = ((at(2, it) - at(0, it)) / (at(1, it) - at(0, it))).clamp(0., 1.);
            share * share * (3. - 2. * share)
        }),
        "isnan" => each(&|it| at(0, it).is_nan().into()),
        "isinf" => each(&|it| at(0, it).is_infinite().into()),
        "floatBitsToInt" | "floatBitsToUint" | "intBitsToFloat" | "uintBitsToFloat" => {
            each(&|it| bits(0, it))
        }
        "packSnorm2x16" => pack(|it| (it.clamp(-1., 1.) * 32767.).round() as i16 as u16),
        "packUnorm2x16" => pack(|it| (it.clamp(0., 1.) * 65535.).round() as u16),
        "packHalf2x16" => pack(to_half),
        "unpackSnorm2x16" => unpack(|it| (f32::from(it as i16) / 32767.).max(-1.)),
        "unpackUnorm2x16" => unpack(|it| f32::from(it) / 65535.),
        "unpackHalf2x16" => unpack(from_half),
        "length" => floats(&|_| dot(all(0), all(0)).sqrt()),
        "distance" => floats(&|_| {
            (0..size)
                .map(|it| (at(0, it) - at(1, it)).powi(2))
                .sum::<f32>()
                .sqrt()
        }),
        "dot" => floats(&|_| dot(all(0), all(1))),
        "cross" => floats(&|it| at(0, it + 1) * at(1, it + 2) - at(0, it + 2) * at(1, it + 1)),
        "normalize" => floats(&|it| at(0, it) / dot(all(0), all(0)).sqrt()),
        "faceforward" => floats(&|it| {
            if dot(all(2), all(1)) < 0. {
                at(0, it)
            } else {
                -at(0, it)
            }
        }),
        "reflect" => floats(&|it| at(0, it) - 2. * dot(all(1), all(0)) * at(1, it)),
        "refract" => floats(&|it| {
            let (cosine, ratio) = (dot(all(1), all(0)), at(2, 0));
            let square = 1. - ratio * ratio * (1. - cosine * cosine);
            if square < 0. {
                0.
            } else {
                ratio * at(0, it) - (ratio * cosine + square.sqrt()) * at(1, it)
            }
        }),
        "matrixCompMult" => floats(&|it| at(0, it) * at(1, it)),
        "outerProduct" => floats(&|it| at(0, it % size) * at(1, it / size)),
        "transpose" => each(&|it| {
            bits(
                0,
                it % usize::from(of.columns) * size + it / usize::from(of.columns),
            )
        }),
        "determinant" => floats(&|_| determinant(&matrix(), size)),
        "inverse" => floats(&|it| {
            cofactor(&matrix(), size, it % size, it / size) / determinant(&matrix(), size)
        }),
        "lessThan" => relation(Known::Less),
        "lessThanEqual" => relation(Known::LessEqual),
        "greaterThan" => relation(Known::Greater),
        "greaterThanEqual" => relation(Known::GreaterEqual),
        "equal" => relation(Known::Equal),
        "notEqual" => relation(Known::NotEqual),
        "any" => each(&|_| all(0).any(|it| it != 0).into()),
        "all" => each(&|_| all(0).all(|it| it != 0).into()),
        "not" => each(&|it| bits(0, it) ^ 1),
        _ => None,
    }
}
