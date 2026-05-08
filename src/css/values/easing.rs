use crate::css_parser as css;
use crate::css_parser::{CssResult as Result, PrintErr, Printer, Token};
use crate::values::number::{CSSInteger, CSSIntegerFns, CSSNumber, CSSNumberFns};
use bun_string::strings;

/// A CSS [easing function](https://www.w3.org/TR/css-easing-1/#easing-functions).
#[derive(Clone, PartialEq)]
pub enum EasingFunction {
    /// A linear easing function.
    Linear,
    /// Equivalent to `cubic-bezier(0.25, 0.1, 0.25, 1)`.
    Ease,
    /// Equivalent to `cubic-bezier(0.42, 0, 1, 1)`.
    EaseIn,
    /// Equivalent to `cubic-bezier(0, 0, 0.58, 1)`.
    EaseOut,
    /// Equivalent to `cubic-bezier(0.42, 0, 0.58, 1)`.
    EaseInOut,
    /// A custom cubic Bézier easing function.
    CubicBezier(CubicBezier),
    /// A step easing function.
    Steps(Steps),
}

#[derive(Clone, PartialEq)]
pub struct CubicBezier {
    /// The x-position of the first point in the curve.
    pub x1: CSSNumber,
    /// The y-position of the first point in the curve.
    pub y1: CSSNumber,
    /// The x-position of the second point in the curve.
    pub x2: CSSNumber,
    /// The y-position of the second point in the curve.
    pub y2: CSSNumber,
}

#[derive(Clone, PartialEq)]
pub struct Steps {
    /// The number of intervals in the function.
    pub count: CSSInteger,
    /// The step position.
    pub position: StepPosition,
}

impl Default for Steps {
    fn default() -> Self {
        Self {
            count: 0,
            position: StepPosition::default(),
        }
    }
}

#[derive(Clone, Copy)]
enum EasingKeyword {
    Linear,
    Ease,
    EaseIn,
    EaseOut,
    EaseInOut,
    StepStart,
    StepEnd,
}

static EASING_MAP: phf::Map<&'static [u8], EasingKeyword> = phf::phf_map! {
    b"linear" => EasingKeyword::Linear,
    b"ease" => EasingKeyword::Ease,
    b"ease-in" => EasingKeyword::EaseIn,
    b"ease-out" => EasingKeyword::EaseOut,
    b"ease-in-out" => EasingKeyword::EaseInOut,
    b"step-start" => EasingKeyword::StepStart,
    b"step-end" => EasingKeyword::StepEnd,
};

/// Zig: `Map.getASCIIICaseInsensitive(ident)` — phf's `get` is byte-exact, so
/// lowercase into a stack buffer first (same pattern as `CalcUnit::get_any_case`).
fn easing_map_get_any_case(ident: &[u8]) -> Option<EasingKeyword> {
    // Longest key is "ease-in-out" / "step-start" (11 bytes).
    if ident.len() > 11 {
        return None;
    }
    let mut buf = [0u8; 11];
    for (i, b) in ident.iter().enumerate() {
        buf[i] = b.to_ascii_lowercase();
    }
    EASING_MAP.get(&buf[..ident.len()]).copied()
}

impl EasingFunction {
    pub fn parse(input: &mut css::Parser) -> Result<EasingFunction> {
        // PORT NOTE: reshaped for borrowck — `try_parse(|i| i.expect_ident())`
        // ties the returned slice to the closure's `&mut Parser` borrow, so the
        // ident can't escape. Read the next token by value (Token slices are
        // `'static` placeholders for the not-yet-threaded `'bump`) and dispatch
        // on Ident vs Function in one go; on any other token, error.
        let location = input.current_source_location();
        let tok = input.next()?.clone();
        if let Token::Ident(ident) = tok {
            let keyword = if let Some(e) = easing_map_get_any_case(ident) {
                match e {
                    EasingKeyword::Linear => EasingFunction::Linear,
                    EasingKeyword::Ease => EasingFunction::Ease,
                    EasingKeyword::EaseIn => EasingFunction::EaseIn,
                    EasingKeyword::EaseOut => EasingFunction::EaseOut,
                    EasingKeyword::EaseInOut => EasingFunction::EaseInOut,
                    EasingKeyword::StepStart => EasingFunction::Steps(Steps {
                        count: 1,
                        position: StepPosition::Start,
                    }),
                    EasingKeyword::StepEnd => EasingFunction::Steps(Steps {
                        count: 1,
                        position: StepPosition::End,
                    }),
                }
            } else {
                return Err(location.new_unexpected_token_error(Token::Ident(ident)));
            };

            return Ok(keyword);
        }

        let Token::Function(function) = tok else {
            return Err(location.new_unexpected_token_error(tok));
        };
        input.parse_nested_block(move |i| {
            if strings::eql_case_insensitive_ascii_check_length(function, b"cubic-bezier") {
                let x1 = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let y1 = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let x2 = CSSNumberFns::parse(i)?;
                i.expect_comma()?;
                let y2 = CSSNumberFns::parse(i)?;
                Ok(EasingFunction::CubicBezier(CubicBezier { x1, y1, x2, y2 }))
            } else if strings::eql_case_insensitive_ascii_check_length(function, b"steps") {
                let count = CSSIntegerFns::parse(i)?;
                let position = i
                    .try_parse(|p| {
                        p.expect_comma()?;
                        StepPosition::parse(p)
                    })
                    .unwrap_or(StepPosition::default());
                Ok(EasingFunction::Steps(Steps { count, position }))
            } else {
                Err(location.new_unexpected_token_error(Token::Ident(function)))
            }
        })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        match self {
            EasingFunction::Linear => dest.write_str("linear"),
            EasingFunction::Ease => dest.write_str("ease"),
            EasingFunction::EaseIn => dest.write_str("ease-in"),
            EasingFunction::EaseOut => dest.write_str("ease-out"),
            EasingFunction::EaseInOut => dest.write_str("ease-in-out"),
            _ => {
                if self.is_ease() {
                    return dest.write_str("ease");
                } else if matches!(self, EasingFunction::CubicBezier(cb) if *cb == CubicBezier {
                    x1: 0.42,
                    y1: 0.0,
                    x2: 1.0,
                    y2: 1.0,
                }) {
                    return dest.write_str("ease-in");
                } else if matches!(self, EasingFunction::CubicBezier(cb) if *cb == CubicBezier {
                    x1: 0.0,
                    y1: 0.0,
                    x2: 0.58,
                    y2: 1.0,
                }) {
                    return dest.write_str("ease-out");
                } else if matches!(self, EasingFunction::CubicBezier(cb) if *cb == CubicBezier {
                    x1: 0.42,
                    y1: 0.0,
                    x2: 0.58,
                    y2: 1.0,
                }) {
                    return dest.write_str("ease-in-out");
                }

                match self {
                    EasingFunction::CubicBezier(cb) => {
                        dest.write_str("cubic-bezier(")?;
                        CSSNumberFns::to_css(&cb.x1, dest)?;
                        dest.write_char(b',')?;
                        CSSNumberFns::to_css(&cb.y1, dest)?;
                        dest.write_char(b',')?;
                        CSSNumberFns::to_css(&cb.x2, dest)?;
                        dest.write_char(b',')?;
                        CSSNumberFns::to_css(&cb.y2, dest)?;
                        dest.write_char(b')')
                    }
                    EasingFunction::Steps(steps) => {
                        if steps.count == 1 && steps.position == StepPosition::Start {
                            return dest.write_str("step-start");
                        }
                        if steps.count == 1 && steps.position == StepPosition::End {
                            return dest.write_str("step-end");
                        }
                        dest.write_fmt(format_args!("steps({}", steps.count))?;
                        dest.delim(b',', false)?;
                        steps.position.to_css(dest)?;
                        dest.write_char(b')')
                    }
                    EasingFunction::Linear
                    | EasingFunction::Ease
                    | EasingFunction::EaseIn
                    | EasingFunction::EaseOut
                    | EasingFunction::EaseInOut => unreachable!(),
                }
            }
        }
    }

    /// Returns whether the given string is a valid easing function name.
    pub fn is_ident(s: &[u8]) -> bool {
        easing_map_get_any_case(s).is_some()
    }

    /// Returns whether the easing function is equivalent to the `ease` keyword.
    pub fn is_ease(&self) -> bool {
        matches!(self, EasingFunction::Ease)
            || matches!(self, EasingFunction::CubicBezier(cb) if *cb == CubicBezier {
                x1: 0.25,
                y1: 0.1,
                x2: 0.25,
                y2: 1.0,
            })
    }
}

/// A [step position](https://www.w3.org/TR/css-easing-1/#step-position), used within the `steps()` function.
#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum StepPosition {
    /// The first rise occurs at input progress value of 0.
    #[strum(serialize = "start")]
    Start,
    /// The last rise occurs at input progress value of 1.
    #[strum(serialize = "end")]
    End,
    /// All rises occur within the range (0, 1).
    #[strum(serialize = "jump-none")]
    JumpNone,
    /// The first rise occurs at input progress value of 0 and the last rise occurs at input progress value of 1.
    #[strum(serialize = "jump-both")]
    JumpBoth,
}

#[derive(Clone, Copy)]
enum StepPositionKeyword {
    Start,
    End,
    JumpNone,
    JumpBoth,
    JumpStart,
    JumpEnd,
}

static STEP_POSITION_MAP: phf::Map<&'static [u8], StepPositionKeyword> = phf::phf_map! {
    b"start" => StepPositionKeyword::Start,
    b"end" => StepPositionKeyword::End,
    b"jump-none" => StepPositionKeyword::JumpNone,
    b"jump-both" => StepPositionKeyword::JumpBoth,
    b"jump-start" => StepPositionKeyword::JumpStart,
    b"jump-end" => StepPositionKeyword::JumpEnd,
};

/// Zig: `Map.getASCIIICaseInsensitive(ident)` — lowercase into a stack buffer
/// before the phf lookup (same pattern as `CalcUnit::get_any_case`).
fn step_position_map_get_any_case(ident: &[u8]) -> Option<StepPositionKeyword> {
    // Longest key is "jump-start" (10 bytes).
    if ident.len() > 10 {
        return None;
    }
    let mut buf = [0u8; 10];
    for (i, b) in ident.iter().enumerate() {
        buf[i] = b.to_ascii_lowercase();
    }
    STEP_POSITION_MAP.get(&buf[..ident.len()]).copied()
}

impl StepPosition {
    // TODO(port): Zig used `css.DeriveToCss(@This()).toCss` — reflection-derived serializer.
    // Phase B: replace with `#[derive(ToCss)]` once the trait/derive exists.
    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        dest.write_str(<&'static str>::from(*self))
    }

    pub fn parse(input: &mut css::Parser) -> Result<StepPosition> {
        let location = input.current_source_location();
        let tok = input.next()?.clone();
        let Token::Ident(ident) = tok else {
            return Err(location.new_unexpected_token_error(tok));
        };
        let keyword = if let Some(e) = step_position_map_get_any_case(ident) {
            match e {
                StepPositionKeyword::Start => StepPosition::Start,
                StepPositionKeyword::End => StepPosition::End,
                StepPositionKeyword::JumpStart => StepPosition::Start,
                StepPositionKeyword::JumpEnd => StepPosition::End,
                StepPositionKeyword::JumpNone => StepPosition::JumpNone,
                StepPositionKeyword::JumpBoth => StepPosition::JumpBoth,
            }
        } else {
            return Err(location.new_unexpected_token_error(Token::Ident(ident)));
        };

        Ok(keyword)
    }
}

impl Default for StepPosition {
    fn default() -> Self {
        StepPosition::End
    }
}

// ported from: src/css/values/easing.zig
