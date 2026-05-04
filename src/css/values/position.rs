use crate as css;
use crate::css_values::length::LengthPercentage;
use crate::css_values::percentage::Percentage;
use crate::{PrintErr, Printer, Result as CssResult};
use bun_alloc::Arena;

/// A CSS `<position>` value,
/// as used in the `background-position` property, gradients, masks, etc.
#[derive(Clone, PartialEq)]
pub struct Position {
    /// The x-position.
    pub x: HorizontalPosition,
    /// The y-position.
    pub y: VerticalPosition,
}

impl Position {
    pub fn parse(input: &mut css::Parser) -> CssResult<Position> {
        // Try parsing a horizontal position first
        if let Some(horizontal_pos) = input.try_parse(HorizontalPosition::parse).as_value() {
            match horizontal_pos {
                PositionComponent::Center => {
                    // Try parsing a vertical position next
                    if let Some(y) = input.try_parse(VerticalPosition::parse).as_value() {
                        return CssResult::Ok(Position {
                            x: PositionComponent::Center,
                            y,
                        });
                    }

                    // If it didn't work, assume the first actually represents a y position,
                    // and the next is an x position. e.g. `center left` rather than `left center`.
                    let x = input
                        .try_parse(HorizontalPosition::parse)
                        .unwrap_or(HorizontalPosition::Center);
                    let y = VerticalPosition::Center;
                    return CssResult::Ok(Position { x, y });
                }
                PositionComponent::Length(x) => {
                    // If we got a length as the first component, then the second must
                    // be a keyword or length (not a side offset).
                    if let Some(y_keyword) =
                        input.try_parse(VerticalPositionKeyword::parse).as_value()
                    {
                        let y = VerticalPosition::Side(PositionComponentSide {
                            side: y_keyword,
                            offset: None,
                        });
                        return CssResult::Ok(Position {
                            x: PositionComponent::Length(x),
                            y,
                        });
                    }
                    if let Some(y_lp) = input.try_parse(LengthPercentage::parse).as_value() {
                        let y = VerticalPosition::Length(y_lp);
                        return CssResult::Ok(Position {
                            x: PositionComponent::Length(x),
                            y,
                        });
                    }
                    let y = VerticalPosition::Center;
                    let _ = input.try_parse(|i| i.expect_ident_matching("center"));
                    return CssResult::Ok(Position {
                        x: PositionComponent::Length(x),
                        y,
                    });
                }
                PositionComponent::Side(side) => {
                    let x_keyword = side.side;
                    let lp = side.offset;

                    // If we got a horizontal side keyword (and optional offset), expect another for the vertical side.
                    // e.g. `left center` or `left 20px center`
                    if input
                        .try_parse(|i| i.expect_ident_matching("center"))
                        .is_ok()
                    {
                        let x = HorizontalPosition::Side(PositionComponentSide {
                            side: x_keyword,
                            offset: lp,
                        });
                        let y = VerticalPosition::Center;
                        return CssResult::Ok(Position { x, y });
                    }

                    // e.g. `left top`, `left top 20px`, `left 20px top`, or `left 20px top 20px`
                    if let Some(y_keyword) =
                        input.try_parse(VerticalPositionKeyword::parse).as_value()
                    {
                        let y_lp = match input.try_parse(LengthPercentage::parse) {
                            CssResult::Ok(vv) => Some(vv),
                            CssResult::Err(_) => None,
                        };
                        let x = HorizontalPosition::Side(PositionComponentSide {
                            side: x_keyword,
                            offset: lp,
                        });
                        let y = VerticalPosition::Side(PositionComponentSide {
                            side: y_keyword,
                            offset: y_lp,
                        });
                        return CssResult::Ok(Position { x, y });
                    }

                    // If we didn't get a vertical side keyword (e.g. `left 20px`), then apply the offset to the vertical side.
                    let x = HorizontalPosition::Side(PositionComponentSide {
                        side: x_keyword,
                        offset: None,
                    });
                    let y = if let Some(lp_val) = lp {
                        VerticalPosition::Length(lp_val)
                    } else {
                        VerticalPosition::Center
                    };
                    return CssResult::Ok(Position { x, y });
                }
            }
        }

        // If the horizontal position didn't parse, then it must be out of order. Try vertical position keyword.
        let y_keyword = match VerticalPositionKeyword::parse(input) {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        let lp_and_x_pos = input.try_parse(
            |i: &mut css::Parser| -> CssResult<(Option<LengthPercentage>, HorizontalPosition)> {
                let y_lp = i.try_parse(LengthPercentage::parse).as_value();
                if let Some(x_keyword) = i.try_parse(HorizontalPositionKeyword::parse).as_value() {
                    let x_lp = i.try_parse(LengthPercentage::parse).as_value();
                    let x_pos = HorizontalPosition::Side(PositionComponentSide {
                        side: x_keyword,
                        offset: x_lp,
                    });
                    return CssResult::Ok((y_lp, x_pos));
                }
                if let Some(e) = i.expect_ident_matching("center").as_err() {
                    return CssResult::Err(e);
                }
                let x_pos = HorizontalPosition::Center;
                CssResult::Ok((y_lp, x_pos))
            },
        );

        if let Some(tuple) = lp_and_x_pos.as_value() {
            let y_lp = tuple.0;
            let x = tuple.1;
            let y = VerticalPosition::Side(PositionComponentSide {
                side: y_keyword,
                offset: y_lp,
            });
            return CssResult::Ok(Position { x, y });
        }

        let x = HorizontalPosition::Center;
        let y = VerticalPosition::Side(PositionComponentSide {
            side: y_keyword,
            offset: None,
        });
        CssResult::Ok(Position { x, y })
    }

    pub fn to_css(&self, dest: &mut css::Printer) -> Result<(), css::PrintErr> {
        // PORT NOTE: reshaped for borrowck — Zig used tag-then-payload-access (`this.x == .side and this.x.side.side != .left`);
        // Rust uses if-let pattern matching to bind payloads.
        if let (PositionComponent::Side(xs), PositionComponent::Length(yl)) = (&self.x, &self.y) {
            if xs.side != HorizontalPositionKeyword::Left {
                self.x.to_css(dest)?;
                dest.write_str(" top ")?;
                return yl.to_css(dest);
            }
        }
        if let PositionComponent::Side(xs) = &self.x {
            if xs.side != HorizontalPositionKeyword::Left && self.y.is_center() {
                // If there is a side keyword with an offset, "center" must be a keyword not a percentage.
                self.x.to_css(dest)?;
                return dest.write_str(" center");
            }
        }
        if let (PositionComponent::Length(xl), PositionComponent::Side(ys)) = (&self.x, &self.y) {
            if ys.side != VerticalPositionKeyword::Top {
                dest.write_str("left ")?;
                xl.to_css(dest)?;
                dest.write_str(" ")?;
                return self.y.to_css(dest);
            }
        }
        if self.x.is_center() && self.y.is_center() {
            // `center center` => 50%
            return self.x.to_css(dest);
        }
        if let PositionComponent::Length(xl) = &self.x {
            if self.y.is_center() {
                // `center` is assumed if omitted.
                return xl.to_css(dest);
            }
        }
        if let PositionComponent::Side(xs) = &self.x {
            if xs.offset.is_none() && self.y.is_center() {
                let p: LengthPercentage = xs.side.into_length_percentage();
                return p.to_css(dest);
            }
        }
        if let PositionComponent::Side(ys) = &self.y {
            if ys.offset.is_none() && self.x.is_center() {
                return self.y.to_css(dest);
            }
        }
        if let (PositionComponent::Side(xs), PositionComponent::Side(ys)) = (&self.x, &self.y) {
            if xs.offset.is_none() && ys.offset.is_none() {
                let x: LengthPercentage = xs.side.into_length_percentage();
                let y: LengthPercentage = ys.side.into_length_percentage();
                x.to_css(dest)?;
                dest.write_str(" ")?;
                return y.to_css(dest);
            }
        }

        let zero = LengthPercentage::zero();
        let fifty = LengthPercentage::Percentage(Percentage { v: 0.5 });
        let x_len: Option<&LengthPercentage> = 'x_len: {
            match &self.x {
                PositionComponent::Side(side) => {
                    if side.side == HorizontalPositionKeyword::Left {
                        if let Some(offset) = &side.offset {
                            if offset.is_zero() {
                                break 'x_len Some(&zero);
                            } else {
                                break 'x_len Some(offset);
                            }
                        } else {
                            break 'x_len Some(&zero);
                        }
                    }
                }
                PositionComponent::Length(len) => {
                    if len.is_zero() {
                        break 'x_len Some(&zero);
                    }
                }
                PositionComponent::Center => break 'x_len Some(&fifty),
            }
            None
        };

        let y_len: Option<&LengthPercentage> = 'y_len: {
            match &self.y {
                PositionComponent::Side(side) => {
                    if side.side == VerticalPositionKeyword::Top {
                        if let Some(offset) = &side.offset {
                            if offset.is_zero() {
                                break 'y_len Some(&zero);
                            } else {
                                break 'y_len Some(offset);
                            }
                        } else {
                            break 'y_len Some(&zero);
                        }
                    }
                }
                PositionComponent::Length(len) => {
                    if len.is_zero() {
                        break 'y_len Some(&zero);
                    }
                }
                PositionComponent::Center => break 'y_len Some(&fifty),
            }
            None
        };

        if let (Some(xl), Some(yl)) = (x_len, y_len) {
            xl.to_css(dest)?;
            dest.write_str(" ")?;
            yl.to_css(dest)
        } else {
            self.x.to_css(dest)?;
            dest.write_str(" ")?;
            self.y.to_css(dest)
        }
    }

    /// Returns whether both the x and y positions are centered.
    pub fn is_center(&self) -> bool {
        self.x.is_center() && self.y.is_center()
    }

    pub fn center() -> Position {
        Position {
            x: PositionComponent::Center,
            y: PositionComponent::Center,
        }
    }

    pub fn eql(&self, other: &Position) -> bool {
        self == other
    }

    pub fn is_zero(&self) -> bool {
        self.x.is_zero() && self.y.is_zero()
    }

    pub fn deep_clone(&self, allocator: &Arena) -> Self {
        // TODO(port): css::implement_deep_clone is comptime-reflection; relies on Clone/arena semantics in Phase B
        css::implement_deep_clone(self, allocator)
    }
}

impl Default for Position {
    fn default() -> Self {
        Position {
            x: HorizontalPosition::Length(LengthPercentage::Percentage(Percentage { v: 0.0 })),
            y: VerticalPosition::Length(LengthPercentage::Percentage(Percentage { v: 0.0 })),
        }
    }
}

/// A side keyword with an optional offset.
#[derive(Clone, PartialEq)]
pub struct PositionComponentSide<S> {
    /// A side keyword.
    pub side: S,
    /// Offset from the side.
    pub offset: Option<LengthPercentage>,
}

impl<S: PartialEq> PositionComponentSide<S> {
    pub fn deep_clone(&self, allocator: &Arena) -> Self {
        // TODO(port): implement_deep_clone is comptime reflection — replace with arena-aware DeepClone trait/derive in Phase B
        css::implement_deep_clone(self, allocator)
    }

    pub fn eql(&self, other: &Self) -> bool {
        self == other
    }
}

/// A component of a CSS `<position>` value (horizontal or vertical).
#[derive(Clone, PartialEq)]
pub enum PositionComponent<S> {
    /// The `center` keyword.
    Center,
    /// A length or percentage from the top-left corner of the box.
    Length(LengthPercentage),
    /// A side keyword with an optional offset.
    Side(PositionComponentSide<S>),
}

// TODO(port): trait names `css::Parse`/`css::ToCss` are best-guess — confirm against the css crate's
// actual trait names in Phase B (Zig used duck-typed `S.parse`/`S.toCss`).
impl<S: css::Parse + css::ToCss + PartialEq> PositionComponent<S> {
    pub fn is_zero(&self) -> bool {
        if let PositionComponent::Length(l) = self {
            if l.is_zero() {
                return true;
            }
        }
        false
    }

    pub fn deep_clone(&self, allocator: &Arena) -> Self {
        // TODO(port): implement_deep_clone is comptime reflection — replace with arena-aware DeepClone trait/derive in Phase B
        css::implement_deep_clone(self, allocator)
    }

    pub fn eql(&self, other: &Self) -> bool {
        self == other
    }

    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        if input
            .try_parse(|i: &mut css::Parser| i.expect_ident_matching("center"))
            .is_ok()
        {
            return CssResult::Ok(PositionComponent::Center);
        }

        if let Some(lp) = input.try_parse(LengthPercentage::parse).as_value() {
            return CssResult::Ok(PositionComponent::Length(lp));
        }

        let side = match S::parse(input) {
            CssResult::Ok(vv) => vv,
            CssResult::Err(e) => return CssResult::Err(e),
        };
        let offset = input.try_parse(LengthPercentage::parse).as_value();
        CssResult::Ok(PositionComponent::Side(PositionComponentSide {
            side,
            offset,
        }))
    }

    pub fn to_css(&self, dest: &mut css::Printer) -> Result<(), css::PrintErr> {
        match self {
            PositionComponent::Center => {
                if dest.minify {
                    dest.write_str("50%")
                } else {
                    dest.write_str("center")
                }
            }
            PositionComponent::Length(lp) => lp.to_css(dest),
            PositionComponent::Side(s) => {
                s.side.to_css(dest)?;
                if let Some(lp) = &s.offset {
                    dest.write_str(" ")?;
                    lp.to_css(dest)?;
                }
                Ok(())
            }
        }
    }

    pub fn is_center(&self) -> bool {
        match self {
            PositionComponent::Center => return true,
            PositionComponent::Length(l) => {
                if let LengthPercentage::Percentage(p) = l {
                    return p.v == 0.5;
                }
            }
            _ => {}
        }
        false
    }
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum HorizontalPositionKeyword {
    /// The `left` keyword.
    Left,
    /// The `right` keyword.
    Right,
}

impl HorizontalPositionKeyword {
    pub fn deep_clone(&self, _allocator: &Arena) -> HorizontalPositionKeyword {
        // Copy enum — comptime-reflection deep_clone reduces to bitwise copy.
        *self
    }

    pub fn eql(&self, other: &HorizontalPositionKeyword) -> bool {
        *self == *other
    }

    pub fn as_str(&self) -> &'static [u8] {
        css::enum_property_util::as_str(self)
    }

    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        css::enum_property_util::parse(input)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        css::enum_property_util::to_css(self, dest)
    }

    pub fn into_length_percentage(&self) -> LengthPercentage {
        match self {
            HorizontalPositionKeyword::Left => LengthPercentage::zero(),
            HorizontalPositionKeyword::Right => {
                LengthPercentage::Percentage(Percentage { v: 1.0 })
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum VerticalPositionKeyword {
    /// The `top` keyword.
    Top,
    /// The `bottom` keyword.
    Bottom,
}

impl VerticalPositionKeyword {
    pub fn deep_clone(&self, _allocator: &Arena) -> Self {
        // Copy enum — comptime-reflection deep_clone reduces to bitwise copy.
        *self
    }

    pub fn eql(&self, other: &VerticalPositionKeyword) -> bool {
        *self == *other
    }

    pub fn as_str(&self) -> &'static [u8] {
        css::enum_property_util::as_str(self)
    }

    pub fn parse(input: &mut css::Parser) -> CssResult<Self> {
        css::enum_property_util::parse(input)
    }

    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        css::enum_property_util::to_css(self, dest)
    }

    pub fn into_length_percentage(&self) -> LengthPercentage {
        match self {
            VerticalPositionKeyword::Top => LengthPercentage::zero(),
            VerticalPositionKeyword::Bottom => {
                LengthPercentage::Percentage(Percentage { v: 1.0 })
            }
        }
    }
}

pub type HorizontalPosition = PositionComponent<HorizontalPositionKeyword>;
pub type VerticalPosition = PositionComponent<VerticalPositionKeyword>;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/position.zig (429 lines)
//   confidence: medium
//   todos:      4
//   notes:      to_css if-else chain reshaped to if-let cascade for borrowck; PositionComponent<S> bounded on css::Parse+ToCss (trait names need Phase B confirm); implement_deep_clone is comptime reflection — needs DeepClone trait/derive in Phase B
// ──────────────────────────────────────────────────────────────────────────
