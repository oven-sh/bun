// ─── B-2 round 8: parse / to_css / ComponentParser / Interpolate un-gated ──
// Full `CssColor::parse` / `to_css` surface, `ComponentParser` /
// `RelativeComponentParser`, the `Colorspace` / `Interpolate` traits,
// `color-mix()`, and the 47-variant `SystemColor` are now real. The
// `From<Src> for Dst` lattice + `ColorGamut`/`map_gamut` were un-gated in
// round 7 and remain at the bottom of the file. The former
// `gated_full_impl` reference module has been folded into the outer scope.

use crate::PrintErr;
use crate::compat::Feature;
use crate::css_parser as css;
use crate::css_parser::CssResult;
use crate::printer::Printer;
use crate::targets;
use crate::values::angle::Angle;
use crate::values::calc::Calc;
use crate::values::number::CSSNumberFns;
use crate::values::percentage::Percentage;
use bun_alloc::Arena;
use bun_core::strings;

// ───────────────────────── colorspace structs ────────────────────────────
// Field layout matches `color.zig`; every space is 3 channels + alpha.

/// A color with red, green, blue, and alpha components, in a byte each.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RGBA {
    pub red: u8,
    pub green: u8,
    pub blue: u8,
    pub alpha: u8,
}

impl RGBA {
    #[inline]
    pub fn new(red: u8, green: u8, blue: u8, alpha: f32) -> RGBA {
        RGBA {
            red,
            green,
            blue,
            alpha: clamp_unit_f32(alpha),
        }
    }

    #[inline]
    pub fn transparent() -> RGBA {
        RGBA {
            red: 0,
            green: 0,
            blue: 0,
            alpha: 0,
        }
    }

    #[inline]
    pub fn red_f32(&self) -> f32 {
        self.red as f32 / 255.0
    }
    #[inline]
    pub fn green_f32(&self) -> f32 {
        self.green as f32 / 255.0
    }
    #[inline]
    pub fn blue_f32(&self) -> f32 {
        self.blue as f32 / 255.0
    }
    #[inline]
    pub fn alpha_f32(&self) -> f32 {
        self.alpha as f32 / 255.0
    }

    #[inline]
    pub fn from_floats(red: f32, green: f32, blue: f32, alpha: f32) -> RGBA {
        RGBA {
            red: clamp_unit_f32(red),
            green: clamp_unit_f32(green),
            blue: clamp_unit_f32(blue),
            alpha: clamp_unit_f32(alpha),
        }
    }

    #[inline]
    pub fn into_srgb(&self) -> SRGB {
        SRGB {
            r: self.red_f32(),
            g: self.green_f32(),
            b: self.blue_f32(),
            alpha: self.alpha_f32(),
        }
    }

    /// Zig: `rgba.into(.HSL)` — routes RGBA → SRGB → HSL.
    #[inline]
    pub fn into_hsl(&self) -> HSL {
        HSL::from_rgba(self)
    }

    /// Zig: `rgba.into(.LAB)` — routes RGBA → SRGB → LAB.
    #[inline]
    pub fn into_lab(&self) -> LAB {
        LAB::from_rgba(self)
    }

    /// Convert any `CssColor` into `RGBA` by routing through `SRGB`.
    /// Zig: `ColorspaceConversions(@This()).tryFromCssColor`.
    #[inline]
    pub fn try_from_css_color(color: &CssColor) -> Option<RGBA> {
        Some(SRGB::try_from_css_color(color)?.into_rgba())
    }
}

/// Convert a unit-interval f32 (nominally 0.0..=1.0) to a u8 in 0..=255.
///
/// Whilst scaling by 256 and flooring would provide an equal distribution of
/// integers to percentage inputs, this is not what Gecko does so we instead
/// multiply by 255 and round (adding 0.5 and flooring is equivalent to rounding).
///
/// Chrome does something similar for the alpha value, but not the rgb values.
///
/// See <https://bugzilla.mozilla.org/show_bug.cgi?id=1340484>
///
/// Clamping to 256 and rounding after would let 1.0 map to 256, and
/// `256.0_f32 as u8` saturates (historically UB):
/// <https://github.com/rust-lang/rust/issues/10184>
///
/// NaN → 0 (clamp passes NaN through; `NaN as u8` saturates to 0).
///
/// NOTE: this *rounds*. Do **not** use for thumbhash, whose spec truncates
/// (`thumbhash.zig:256` `@intFromFloat`).
#[inline]
pub fn clamp_unit_f32(val: f32) -> u8 {
    (val * 255.0).round().clamp(0.0, 255.0) as u8
}

/// A color in a LAB color space (`lab()`/`lch()`/`oklab()`/`oklch()`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LABColor {
    Lab(LAB),
    Lch(LCH),
    Oklab(OKLAB),
    Oklch(OKLCH),
}
/// Dependent crates spell this `LabColor`; alias both casings.
pub type LabColor = LABColor;

/// A color in a predefined color space, e.g. `display-p3`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PredefinedColor {
    Srgb(SRGB),
    SrgbLinear(SRGBLinear),
    DisplayP3(P3),
    A98(A98),
    Prophoto(ProPhoto),
    Rec2020(Rec2020),
    XyzD50(XYZd50),
    XyzD65(XYZd65),
}

/// Floating-point RGB/HSL/HWB used when a color carries `none` components.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum FloatColor {
    Rgb(SRGB),
    Hsl(HSL),
    Hwb(HWB),
}

// ──────────────────────────────────────────────────────────────────────────
// Variant dispatch — single source of truth for (Variant ↔ Payload type ↔
// css-name ↔ hash-ordinal). Every match-over-all-variants in this file is
// driven from the three `impl_variant_dispatch!` invocations below; do NOT
// hand-roll a new copy.
//
// Mirrors Zig's `switch (color.*) { inline else => |*v| v.into(T) }` shape
// (color.zig:3213 `ColorspaceConversions`) which the original Rust port
// regressed into 14 textual copies inside `define_colorspace!`.
//
// ROW ORDER IS LOAD-BEARING: ordinals feed `CssColor::hash` (Wyhash).
// css-name is NOT derivable from the ident: `XyzD65` serializes as `"xyz"`
// (Safari-15 compat), and `FloatColor::Rgb`'s payload type is `SRGB`.
// ──────────────────────────────────────────────────────────────────────────

/// Marker for any `T` that has the full `From<_>` lattice over every concrete
/// colorspace payload (every `define_colorspace!` type does, via the handwritten
/// + generated `From` impls). Lets `convert_to::<T>()` dispatch `v.into()`
/// uniformly without re-stamping the match per `T`.
pub trait FromAnyColorspace:
    From<LAB> + From<LCH> + From<OKLAB> + From<OKLCH>
    + From<SRGB> + From<SRGBLinear> + From<P3> + From<A98>
    + From<ProPhoto> + From<Rec2020> + From<XYZd50> + From<XYZd65>
    + From<HSL> + From<HWB>
{
}
impl<T> FromAnyColorspace for T where
    T: From<LAB> + From<LCH> + From<OKLAB> + From<OKLCH>
        + From<SRGB> + From<SRGBLinear> + From<P3> + From<A98>
        + From<ProPhoto> + From<Rec2020> + From<XYZd50> + From<XYZd65>
        + From<HSL> + From<HWB>
{
}

macro_rules! impl_variant_dispatch {
    ($Enum:ident { $( $ord:literal => $Var:ident($Payload:ty) = $name:literal ),+ $(,)? }) => {
        impl $Enum {
            /// `switch (e) { inline else => |v| v.into(T) }`
            #[inline]
            pub fn convert_to<T: FromAnyColorspace>(&self) -> T {
                match *self { $( $Enum::$Var(v) => v.into(), )+ }
            }
            #[inline]
            pub fn payload_type_id(&self) -> core::any::TypeId {
                match *self { $( $Enum::$Var(_) => core::any::TypeId::of::<$Payload>(), )+ }
            }
            /// Stable per-enum ordinal — feeds `CssColor::hash`. Do NOT reorder rows.
            #[inline]
            pub fn ordinal(&self) -> u32 {
                match *self { $( $Enum::$Var(_) => $ord, )+ }
            }
            #[inline]
            pub fn components(&self) -> (f32, f32, f32, f32) {
                match *self { $( $Enum::$Var(v) => Colorspace::components(&v), )+ }
            }
            #[inline]
            pub fn css_name(&self) -> &'static str {
                match *self { $( $Enum::$Var(_) => $name, )+ }
            }
        }
    };
}

impl_variant_dispatch! { LABColor {
    0 => Lab(LAB)     = "lab",
    1 => Lch(LCH)     = "lch",
    2 => Oklab(OKLAB) = "oklab",
    3 => Oklch(OKLCH) = "oklch",
}}
impl_variant_dispatch! { PredefinedColor {
    0 => Srgb(SRGB)             = "srgb",
    1 => SrgbLinear(SRGBLinear) = "srgb-linear",
    2 => DisplayP3(P3)          = "display-p3",
    3 => A98(A98)               = "a98-rgb",
    4 => Prophoto(ProPhoto)     = "prophoto-rgb",
    5 => Rec2020(Rec2020)       = "rec2020",
    6 => XyzD50(XYZd50)         = "xyz-d50",
    // "xyz" has better compatibility (Safari 15) than "xyz-d65", and it is shorter.
    7 => XyzD65(XYZd65)         = "xyz",
}}
impl_variant_dispatch! { FloatColor {
    0 => Rgb(SRGB) = "rgb",
    1 => Hsl(HSL)  = "hsl",
    2 => Hwb(HWB)  = "hwb",
}}

/// A CSS [system color](https://drafts.csswg.org/css-color/#css-system-colors) keyword.
/// *NOTE* these are intentionally in flat case
#[derive(Debug, Clone, Copy, PartialEq, Eq, crate::DefineEnumProperty)]
pub enum SystemColor {
    /// Background of accented user interface controls.
    Accentcolor,
    /// Text of accented user interface controls.
    Accentcolortext,
    /// Text in active links. For light backgrounds, traditionally red.
    Activetext,
    /// The base border color for push buttons.
    Buttonborder,
    /// The face background color for push buttons.
    Buttonface,
    /// Text on push buttons.
    Buttontext,
    /// Background of application content or documents.
    Canvas,
    /// Text in application content or documents.
    Canvastext,
    /// Background of input fields.
    Field,
    /// Text in input fields.
    Fieldtext,
    /// Disabled text. (Often, but not necessarily, gray.)
    Graytext,
    /// Background of selected text, for example from ::selection.
    Highlight,
    /// Text of selected text.
    Highlighttext,
    /// Text in non-active, non-visited links. For light backgrounds, traditionally blue.
    Linktext,
    /// Background of text that has been specially marked (such as by the HTML mark element).
    Mark,
    /// Text that has been specially marked (such as by the HTML mark element).
    Marktext,
    /// Background of selected items, for example a selected checkbox.
    Selecteditem,
    /// Text of selected items.
    Selecteditemtext,
    /// Text in visited links. For light backgrounds, traditionally purple.
    Visitedtext,

    // Deprecated colors: https://drafts.csswg.org/css-color/#deprecated-system-colors
    /// Active window border. Same as ButtonBorder.
    Activeborder,
    /// Active window caption. Same as Canvas.
    Activecaption,
    /// Background color of multiple document interface. Same as Canvas.
    Appworkspace,
    /// Desktop background. Same as Canvas.
    Background,
    /// The color of the border facing the light source for 3-D elements that appear 3-D due to one layer of surrounding border. Same as ButtonFace.
    Buttonhighlight,
    /// The color of the border away from the light source for 3-D elements that appear 3-D due to one layer of surrounding border. Same as ButtonFace.
    Buttonshadow,
    /// Text in caption, size box, and scrollbar arrow box. Same as CanvasText.
    Captiontext,
    /// Inactive window border. Same as ButtonBorder.
    Inactiveborder,
    /// Inactive window caption. Same as Canvas.
    Inactivecaption,
    /// Color of text in an inactive caption. Same as GrayText.
    Inactivecaptiontext,
    /// Background color for tooltip controls. Same as Canvas.
    Infobackground,
    /// Text color for tooltip controls. Same as CanvasText.
    Infotext,
    /// Menu background. Same as Canvas.
    Menu,
    /// Text in menus. Same as CanvasText.
    Menutext,
    /// Scroll bar gray area. Same as Canvas.
    Scrollbar,
    /// The color of the darker (generally outer) of the two borders away from the light source for 3-D elements that appear 3-D due to two concentric layers of surrounding border. Same as ButtonBorder.
    Threeddarkshadow,
    /// The face background color for 3-D elements that appear 3-D due to two concentric layers of surrounding border. Same as ButtonFace.
    Threedface,
    /// The color of the lighter (generally outer) of the two borders facing the light source for 3-D elements that appear 3-D due to two concentric layers of surrounding border. Same as ButtonBorder.
    Threedhighlight,
    /// The color of the darker (generally inner) of the two borders facing the light source for 3-D elements that appear 3-D due to two concentric layers of surrounding border. Same as ButtonBorder.
    Threedlightshadow,
    /// The color of the lighter (generally inner) of the two borders away from the light source for 3-D elements that appear 3-D due to two concentric layers of surrounding border. Same as ButtonBorder.
    Threedshadow,
    /// Window background. Same as Canvas.
    Window,
    /// Window frame. Same as ButtonBorder.
    Windowframe,
    /// Text in windows. Same as CanvasText.
    Windowtext,
}

impl SystemColor {
    pub fn is_compatible(self, browsers: targets::Browsers) -> bool {
        match self {
            SystemColor::Accentcolor | SystemColor::Accentcolortext => {
                Feature::AccentSystemColor.is_compatible(browsers)
            }
            _ => true,
        }
    }
}

/// A CSS `<color>` value.
#[derive(Debug, Clone, PartialEq)]
pub enum CssColor {
    /// The `currentColor` keyword.
    CurrentColor,
    /// An RGBA color (hex / `rgb()` / `hsl()` / `hwb()`).
    Rgba(RGBA),
    /// A LAB-space color (`lab()`/`lch()`/`oklab()`/`oklch()`).
    Lab(Box<LABColor>),
    /// A predefined-space color (`color(display-p3 …)`).
    Predefined(Box<PredefinedColor>),
    /// Float RGB/HSL/HWB carrying `none` components.
    Float(Box<FloatColor>),
    /// `light-dark()`.
    LightDark {
        light: Box<CssColor>,
        dark: Box<CssColor>,
    },
    /// A system-color keyword.
    System(SystemColor),
}

/// `Result(CssColor)` — Zig: `pub const ParseResult = Result(CssColor);`
pub type ParseResult = css::CssResult<CssColor>;

impl Default for CssColor {
    #[inline]
    fn default() -> CssColor {
        CssColor::Rgba(RGBA::transparent())
    }
}

impl CssColor {
    // TODO(port): move to *_jsc — `pub const jsFunctionColor = @import("../../css_jsc/color_js.zig").jsFunctionColor;`

    /// Parse a CSS `<color>` from the parser cursor.
    pub fn parse(input: &mut css::Parser) -> CssResult<CssColor> {
        let location = input.current_source_location();
        let token = input.next()?.clone();

        match token {
            css::Token::UnrestrictedHash(v) | css::Token::IdHash(v) => {
                let Some((r, g, b, a)) = css::color::parse_hash_color(v) else {
                    return Err(location.new_unexpected_token_error(token));
                };
                Ok(CssColor::Rgba(RGBA::new(r, g, b, a)))
            }
            css::Token::Ident(value) => crate::match_ignore_ascii_case! { value, {
                b"currentcolor" => Ok(CssColor::CurrentColor),
                b"transparent" => Ok(CssColor::Rgba(RGBA::transparent())),
                _ => {
                    if let Some((r, g, b)) = css::color::parse_named_color(value) {
                        Ok(CssColor::Rgba(RGBA::new(r, g, b, 255.0)))
                    } else if let Some(system_color) =
                        <SystemColor as css::EnumProperty>::from_ascii_case_insensitive(value)
                    {
                        Ok(CssColor::System(system_color))
                    } else {
                        Err(location.new_unexpected_token_error(token))
                    }
                },
            }},
            css::Token::Function(name) => parse_color_function(location, name, input),
            _ => Err(location.new_unexpected_token_error(token)),
        }
    }

    /// Serialize this color to CSS text via `dest`.
    pub fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        match self {
            CssColor::CurrentColor => dest.write_str("currentColor"),
            CssColor::Rgba(color) => {
                if color.alpha == 255 {
                    let hex: u32 = ((color.red as u32) << 16)
                        | ((color.green as u32) << 8)
                        | (color.blue as u32);
                    if let Some(name) = short_color_name(hex) {
                        return dest.write_str(name);
                    }

                    let compact = compact_hex(hex);
                    if hex == expand_hex(compact) {
                        dest.write_fmt(format_args!("#{:03x}", compact))?;
                    } else {
                        dest.write_fmt(format_args!("#{:06x}", hex))?;
                    }
                } else {
                    // If the #rrggbbaa syntax is not supported by the browser targets, output rgba()
                    if dest.targets.should_compile_same(Feature::HexAlphaColors) {
                        // If the browser doesn't support `#rrggbbaa` color syntax, it is converted to `transparent` when compressed(minify = true).
                        // https://www.w3.org/TR/css-color-4/#transparent-black
                        if dest.minify
                            && color.red == 0
                            && color.green == 0
                            && color.blue == 0
                            && color.alpha == 0
                        {
                            return dest.write_str("transparent");
                        } else {
                            dest.write_fmt(format_args!("rgba({}", color.red))?;
                            dest.delim(b',', false)?;
                            dest.write_fmt(format_args!("{}", color.green))?;
                            dest.delim(b',', false)?;
                            dest.write_fmt(format_args!("{}", color.blue))?;
                            dest.delim(b',', false)?;

                            // Try first with two decimal places, then with three.
                            let mut rounded_alpha = (color.alpha_f32() * 100.0).round() / 100.0;
                            let clamped = clamp_unit_f32(rounded_alpha);
                            if clamped != color.alpha {
                                rounded_alpha = (color.alpha_f32() * 1000.0).round() / 1000.0;
                            }

                            CSSNumberFns::to_css(&rounded_alpha, dest)?;
                            dest.write_char(b')')?;
                            return Ok(());
                        }
                    }

                    let hex: u32 = ((color.red as u32) << 24)
                        | ((color.green as u32) << 16)
                        | ((color.blue as u32) << 8)
                        | (color.alpha as u32);
                    let compact = compact_hex(hex);
                    if hex == expand_hex(compact) {
                        dest.write_fmt(format_args!("#{:04x}", compact))?;
                    } else {
                        dest.write_fmt(format_args!("#{:08x}", hex))?;
                    }
                }
                Ok(())
            }
            CssColor::Lab(lab) => {
                let (a, b, c, alpha) = lab.components();
                write_components(lab.css_name(), a, b, c, alpha, dest)
            }
            CssColor::Predefined(predefined) => write_predefined(predefined, dest),
            CssColor::Float(float) => {
                // Serialize as hex.
                let srgb = SRGB::from_float_color(float);
                let as_css_color = srgb.into_css_color();
                as_css_color.to_css(dest)
                // `as_css_color` drops here.
            }
            CssColor::LightDark { light, dark } => {
                if !dest.targets.is_compatible(Feature::LightDark) {
                    dest.write_str("var(--buncss-light")?;
                    dest.delim(b',', false)?;
                    light.to_css(dest)?;
                    dest.write_char(b')')?;
                    dest.whitespace()?;
                    dest.write_str("var(--buncss-dark")?;
                    dest.delim(b',', false)?;
                    dark.to_css(dest)?;
                    return dest.write_char(b')');
                }

                dest.write_str("light-dark(")?;
                light.to_css(dest)?;
                dest.delim(b',', false)?;
                dark.to_css(dest)?;
                dest.write_char(b')')
            }
            CssColor::System(system) => system.to_css(dest),
        }
    }

    pub fn is_compatible(&self, browsers: targets::Browsers) -> bool {
        match self {
            CssColor::CurrentColor | CssColor::Rgba(_) | CssColor::Float(_) => true,
            CssColor::Lab(lab) => match **lab {
                LABColor::Lab(_) | LABColor::Lch(_) => Feature::LabColors.is_compatible(browsers),
                LABColor::Oklab(_) | LABColor::Oklch(_) => {
                    Feature::OklabColors.is_compatible(browsers)
                }
            },
            CssColor::Predefined(predefined) => match **predefined {
                PredefinedColor::DisplayP3(_) => Feature::P3Colors.is_compatible(browsers),
                _ => Feature::ColorFunction.is_compatible(browsers),
            },
            CssColor::LightDark { light, dark } => {
                Feature::LightDark.is_compatible(browsers)
                    && light.is_compatible(browsers)
                    && dark.is_compatible(browsers)
            }
            CssColor::System(system) => system.is_compatible(browsers),
        }
    }

    /// Project this color into the given fallback colorspace.
    pub fn get_fallback(&self, _arena: &Arena, kind: ColorFallbackKind) -> CssColor {
        if matches!(self, CssColor::Rgba(_)) {
            return self.clone();
        }
        match kind.bits() {
            x if x == ColorFallbackKind::RGB.bits() => self
                .to_rgb()
                .expect("infallible: fallback implies convertible"),
            x if x == ColorFallbackKind::P3.bits() => self
                .to_p3()
                .expect("infallible: fallback implies convertible"),
            x if x == ColorFallbackKind::LAB.bits() => self
                .to_lab()
                .expect("infallible: fallback implies convertible"),
            _ => unreachable!("Expected RGBA, P3, LAB fallback. This is a bug in Bun."),
        }
    }

    pub fn get_fallbacks(
        &mut self,
        _arena: &Arena,
        targets: targets::Targets,
    ) -> crate::SmallList<CssColor, 2> {
        let fallbacks = self.get_necessary_fallbacks(targets);

        let mut res = crate::SmallList::<CssColor, 2>::default();

        if fallbacks.contains(ColorFallbackKind::RGB) {
            // PERF(port): was assume_capacity
            res.append(
                self.to_rgb()
                    .expect("infallible: fallback implies convertible"),
            );
        }

        if fallbacks.contains(ColorFallbackKind::P3) {
            // PERF(port): was assume_capacity
            res.append(
                self.to_p3()
                    .expect("infallible: fallback implies convertible"),
            );
        }

        if fallbacks.contains(ColorFallbackKind::LAB) {
            *self = self
                .to_lab()
                .expect("infallible: fallback implies convertible");
        }

        res
    }

    /// Returns the color fallback types needed for the given browser targets.
    pub fn get_necessary_fallbacks(&self, targets: targets::Targets) -> ColorFallbackKind {
        // Get the full set of possible fallbacks, and remove the highest one, which
        // will replace the original declaration. The remaining fallbacks need to be added.
        let fallbacks = self.get_possible_fallbacks(targets);
        fallbacks.difference(fallbacks.highest())
    }

    pub fn get_possible_fallbacks(&self, targets: targets::Targets) -> ColorFallbackKind {
        // Fallbacks occur in levels: Oklab -> Lab -> P3 -> RGB. We start with all levels
        // below and including the authored color space, and remove the ones that aren't
        // compatible with our browser targets.
        let mut fallbacks: ColorFallbackKind = match self {
            CssColor::CurrentColor
            | CssColor::Rgba(_)
            | CssColor::Float(_)
            | CssColor::System(_) => {
                return ColorFallbackKind::empty();
            }
            CssColor::Lab(lab) => 'brk: {
                // PORT NOTE: Zig `or`/`and` precedence preserved verbatim:
                // `lab == .lab or (lab == .lch and shouldCompileSame(.lab_colors))`.
                if matches!(**lab, LABColor::Lab(_))
                    || matches!(**lab, LABColor::Lch(_))
                        && targets.should_compile_same(Feature::LabColors)
                {
                    break 'brk ColorFallbackKind::LAB.and_below();
                }
                if matches!(**lab, LABColor::Oklab(_))
                    || matches!(**lab, LABColor::Oklch(_))
                        && targets.should_compile_same(Feature::OklabColors)
                {
                    break 'brk ColorFallbackKind::OKLAB.and_below();
                }
                return ColorFallbackKind::empty();
            }
            CssColor::Predefined(predefined) => 'brk: {
                if matches!(**predefined, PredefinedColor::DisplayP3(_))
                    && targets.should_compile_same(Feature::P3Colors)
                {
                    break 'brk ColorFallbackKind::P3.and_below();
                }
                if targets.should_compile_same(Feature::ColorFunction) {
                    break 'brk ColorFallbackKind::LAB.and_below();
                }
                return ColorFallbackKind::empty();
            }
            CssColor::LightDark { light, dark } => {
                return light.get_possible_fallbacks(targets)
                    | dark.get_possible_fallbacks(targets);
            }
        };

        if fallbacks.contains(ColorFallbackKind::OKLAB) {
            if !targets.should_compile_same(Feature::OklabColors) {
                fallbacks = fallbacks.difference(ColorFallbackKind::LAB.and_below());
            }
        }

        if fallbacks.contains(ColorFallbackKind::LAB) {
            if !targets.should_compile_same(Feature::LabColors) {
                fallbacks = fallbacks.difference(ColorFallbackKind::P3.and_below());
            } else if targets
                .browsers
                .map_or(false, |b| Feature::LabColors.is_partially_compatible(b))
            {
                // We don't need P3 if Lab is supported by some of our targets.
                // No browser implements Lab but not P3.
                fallbacks.remove(ColorFallbackKind::P3);
            }
        }

        if fallbacks.contains(ColorFallbackKind::P3) {
            if !targets.should_compile_same(Feature::P3Colors) {
                fallbacks.remove(ColorFallbackKind::RGB);
            } else if fallbacks.highest() != ColorFallbackKind::P3
                && targets
                    .browsers
                    .map_or(true, |b| !Feature::P3Colors.is_partially_compatible(b))
            {
                // Remove P3 if it isn't supported by any targets, and wasn't the
                // original authored color.
                fallbacks.remove(ColorFallbackKind::P3);
            }
        }

        fallbacks
    }

    #[inline]
    pub fn deep_clone(&self, _arena: &Arena) -> CssColor {
        self.clone()
    }

    pub fn to_light_dark(&self) -> CssColor {
        match self {
            CssColor::LightDark { .. } => self.clone(),
            _ => CssColor::LightDark {
                light: Box::new(self.clone()),
                dark: Box::new(self.clone()),
            },
        }
    }

    #[inline]
    pub fn light_dark_owned(light: CssColor, dark: CssColor) -> CssColor {
        CssColor::LightDark {
            light: Box::new(light),
            dark: Box::new(dark),
        }
    }

    pub fn to_rgb(&self) -> Option<CssColor> {
        if let CssColor::LightDark { light, dark } = self {
            return Some(CssColor::LightDark {
                light: Box::new(light.to_rgb()?),
                dark: Box::new(dark.to_rgb()?),
            });
        }
        Some(CssColor::Rgba(RGBA::try_from_css_color(self)?))
    }

    pub fn to_p3(&self) -> Option<CssColor> {
        match self {
            CssColor::LightDark {
                light: ld_light,
                dark: ld_dark,
            } => {
                let light = ld_light.to_p3()?;
                let dark = ld_dark.to_p3()?;
                Some(CssColor::LightDark {
                    light: Box::new(light),
                    dark: Box::new(dark),
                })
            }
            _ => Some(CssColor::Predefined(Box::new(PredefinedColor::DisplayP3(
                P3::try_from_css_color(self)?,
            )))),
        }
    }

    pub fn to_lab(&self) -> Option<CssColor> {
        match self {
            CssColor::LightDark {
                light: ld_light,
                dark: ld_dark,
            } => {
                let light = ld_light.to_lab()?;
                let dark = ld_dark.to_lab()?;
                Some(CssColor::LightDark {
                    light: Box::new(light),
                    dark: Box::new(dark),
                })
            }
            _ => Some(CssColor::Lab(Box::new(LABColor::Lab(
                LAB::try_from_css_color(self)?,
            )))),
        }
    }

    /// Mixes this color with another color, including the specified amount of each.
    /// Implemented according to the [`color-mix()`](https://www.w3.org/TR/css-color-5/#color-mix) function.
    // PERF: these little allocations feel bad
    pub fn interpolate<T>(
        &self,
        mut p1: f32,
        other: &CssColor,
        mut p2: f32,
        method: HueInterpolationMethod,
    ) -> Option<CssColor>
    where
        T: Colorspace
            + ColorGamut
            + Interpolate
            + Into<OKLCH>
            + From<OKLCH>
            + Into<OKLAB>
            + 'static,
    {
        if matches!(self, CssColor::CurrentColor) || matches!(other, CssColor::CurrentColor) {
            return None;
        }

        if matches!(self, CssColor::LightDark { .. }) || matches!(other, CssColor::LightDark { .. })
        {
            let this_light_dark = self.to_light_dark();
            let other_light_dark = other.to_light_dark();

            let CssColor::LightDark {
                light: al,
                dark: ad,
            } = this_light_dark
            else {
                unreachable!()
            };
            let CssColor::LightDark {
                light: bl,
                dark: bd,
            } = other_light_dark
            else {
                unreachable!()
            };

            return Some(CssColor::LightDark {
                light: Box::new(al.interpolate::<T>(p1, &bl, p2, method)?),
                dark: Box::new(ad.interpolate::<T>(p1, &bd, p2, method)?),
            });
        }

        fn check_converted<T: 'static>(color: &CssColor) -> Option<bool> {
            use core::any::TypeId;
            debug_assert!(!matches!(
                color,
                CssColor::LightDark { .. } | CssColor::CurrentColor
            ));
            match color {
                CssColor::Rgba(_) => Some(TypeId::of::<T>() == TypeId::of::<RGBA>()),
                CssColor::Lab(lab) => Some(TypeId::of::<T>() == lab.payload_type_id()),
                CssColor::Predefined(pre) => Some(TypeId::of::<T>() == pre.payload_type_id()),
                CssColor::Float(f) => Some(TypeId::of::<T>() == f.payload_type_id()),
                // System colors cannot be converted to specific color spaces at parse time
                CssColor::System(_) => None,
                // We checked these above
                CssColor::LightDark { .. } | CssColor::CurrentColor => unreachable!(),
            }
        }

        let converted_first = check_converted::<T>(self)?;
        let converted_second = check_converted::<T>(other)?;

        // https://drafts.csswg.org/css-color-5/#color-mix-result
        let mut first_color = T::try_from_css_color(self)?;
        let mut second_color = T::try_from_css_color(other)?;

        if converted_first && !first_color.in_gamut() {
            first_color = map_gamut(first_color);
        }

        if converted_second && !second_color.in_gamut() {
            second_color = map_gamut(second_color);
        }

        // https://www.w3.org/TR/css-color-4/#powerless
        if converted_first {
            first_color.adjust_powerless_components();
        }

        if converted_second {
            second_color.adjust_powerless_components();
        }

        // https://drafts.csswg.org/css-color-4/#interpolation-missing
        first_color.fill_missing_components(&second_color);
        second_color.fill_missing_components(&first_color);

        // https://www.w3.org/TR/css-color-4/#hue-interpolation
        first_color.adjust_hue(&mut second_color, method);

        // https://www.w3.org/TR/css-color-4/#interpolation-alpha
        first_color.premultiply();
        second_color.premultiply();

        // https://drafts.csswg.org/css-color-5/#color-mix-percent-norm
        let mut alpha_multiplier = p1 + p2;
        if alpha_multiplier != 1.0 {
            p1 = p1 / alpha_multiplier;
            p2 = p2 / alpha_multiplier;
            if alpha_multiplier > 1.0 {
                alpha_multiplier = 1.0;
            }
        }

        let mut result_color = first_color.interpolate(p1, &second_color, p2);

        result_color.unpremultiply(alpha_multiplier);

        Some(result_color.into_css_color())
    }

    pub fn hash(&self, hasher: &mut bun_wyhash::Wyhash) {
        // PORT NOTE: Zig `css.implementHash` — variant-tag prefix + payload fields.
        // Hash the discriminant + the active variant's f32 components explicitly;
        // never reinterpret a `repr(Rust)` enum as raw bytes (unspecified layout /
        // padding → UB and non-deterministic hashes).
        #[inline]
        fn hash_components(
            hasher: &mut bun_wyhash::Wyhash,
            tag: u32,
            (a, b, c, alpha): (f32, f32, f32, f32),
        ) {
            hasher.update(&tag.to_ne_bytes());
            hasher.update(&a.to_ne_bytes());
            hasher.update(&b.to_ne_bytes());
            hasher.update(&c.to_ne_bytes());
            hasher.update(&alpha.to_ne_bytes());
        }
        match self {
            CssColor::CurrentColor => hasher.update(&0u32.to_ne_bytes()),
            CssColor::Rgba(rgba) => {
                hasher.update(&1u32.to_ne_bytes());
                hasher.update(&[rgba.red, rgba.green, rgba.blue, rgba.alpha]);
            }
            CssColor::Lab(lab) => {
                hasher.update(&2u32.to_ne_bytes());
                hash_components(hasher, lab.ordinal(), lab.components());
            }
            CssColor::Predefined(p) => {
                hasher.update(&3u32.to_ne_bytes());
                hash_components(hasher, p.ordinal(), p.components());
            }
            CssColor::Float(fl) => {
                hasher.update(&4u32.to_ne_bytes());
                hash_components(hasher, fl.ordinal(), fl.components());
            }
            CssColor::LightDark { light, dark } => {
                hasher.update(&5u32.to_ne_bytes());
                light.hash(hasher);
                dark.hash(hasher);
            }
            CssColor::System(sys) => {
                hasher.update(&6u32.to_ne_bytes());
                hasher.update(&(*sys as u32).to_ne_bytes());
            }
        }
    }
}

impl crate::generics::ToCss for CssColor {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        CssColor::to_css(self, dest)
    }
}

// `light_dark` payload helpers (Zig anonymous struct methods)
// `takeLightFreeDark` / `takeDarkFreeLight` — in Rust, taking ownership of one
// `Box` and dropping the other is just destructuring; provided as free fns.
#[inline]
pub fn take_light_free_dark(light: Box<CssColor>, dark: Box<CssColor>) -> Box<CssColor> {
    drop(dark);
    light
}
#[inline]
pub fn take_dark_free_light(light: Box<CssColor>, dark: Box<CssColor>) -> Box<CssColor> {
    drop(light);
    dark
}

// ──────────────────────────── ColorFallbackKind ──────────────────────────
bitflags::bitflags! {
    /// A color type that is used as a fallback when compiling colors for
    /// older browsers.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
    pub struct ColorFallbackKind: u8 {
        const RGB   = 1 << 0;
        const P3    = 1 << 1;
        const LAB   = 1 << 2;
        const OKLAB = 1 << 3;
    }
}

impl ColorFallbackKind {
    pub fn lowest(self) -> ColorFallbackKind {
        ColorFallbackKind::from_bits_truncate(self.bits() & self.bits().wrapping_neg())
    }

    pub fn highest(self) -> ColorFallbackKind {
        if self.is_empty() {
            return ColorFallbackKind::empty();
        }
        let zeroes: u32 = 7 - self.bits().leading_zeros();
        ColorFallbackKind::from_bits_truncate(1u8 << zeroes)
    }

    pub fn and_below(self) -> ColorFallbackKind {
        if self.is_empty() {
            return ColorFallbackKind::empty();
        }
        self | ColorFallbackKind::from_bits_truncate(self.bits() - 1)
    }

    pub fn supports_condition(self) -> css::SupportsCondition {
        let s: &'static [u8] = match self.bits() {
            b if b == ColorFallbackKind::P3.bits() => b"color(display-p3 0 0 0)",
            b if b == ColorFallbackKind::LAB.bits() => b"lab(0% 0 0)",
            _ => unreachable!("Expected P3 or LAB. This is a bug in Bun."),
        };

        css::SupportsCondition::Declaration(css::css_rules::supports::Declaration {
            property_id: css::PropertyId::Color,
            value: s,
        })
    }
}

#[allow(unused_imports)]
use super::color_generated::generated_color_conversions as _;

// ──────────────────────────────────────────────────────────────────────────
// Colorspace traits (replaces Zig comptime mixins: DefineColorspace,
// BoundedColorGamut, UnboundedColorGamut, HslHwbColorGamut, DeriveInterpolate,
// RecangularPremultiply, PolarPremultiply, AdjustPowerlessLAB/LCH,
// ColorspaceConversions, ColorIntoMixin, ImplementIntoCssColor)
// ──────────────────────────────────────────────────────────────────────────

/// Trait every colorspace implements. The Zig used `@field(this, "x")` over the
/// first three struct fields plus `alpha`; here we expose them by index.
/// `// TODO(port): Phase B may want to derive this with a proc-macro.`
pub trait Colorspace: Copy + Sized + FromAnyColorspace {
    const CHANNEL_NAMES: (&'static [u8], &'static [u8], &'static [u8]);
    const CHANNEL_TYPES: (ChannelType, ChannelType, ChannelType);

    fn components(&self) -> (f32, f32, f32, f32);
    fn components_mut(&mut self) -> (&mut f32, &mut f32, &mut f32, &mut f32);

    fn channels(&self) -> (&'static [u8], &'static [u8], &'static [u8]) {
        Self::CHANNEL_NAMES
    }
    fn types(&self) -> (ChannelType, ChannelType, ChannelType) {
        Self::CHANNEL_TYPES
    }

    fn resolve_missing(&self) -> Self {
        let mut result = *self;
        let (a, b, c, alpha) = result.components_mut();
        if a.is_nan() {
            *a = 0.0;
        }
        if b.is_nan() {
            *b = 0.0;
        }
        if c.is_nan() {
            *c = 0.0;
        }
        if alpha.is_nan() {
            *alpha = 0.0;
        }
        result
    }

    fn resolve(&self) -> Self
    where
        Self: ColorGamut + Into<OKLCH> + From<OKLCH> + Into<OKLAB>,
    {
        let mut resolved = self.resolve_missing();
        if !resolved.in_gamut() {
            resolved = map_gamut(resolved);
        }
        resolved
    }

    #[inline]
    fn from_lab_color(c: &LABColor) -> Self {
        c.convert_to()
    }
    #[inline]
    fn from_predefined_color(c: &PredefinedColor) -> Self {
        c.convert_to()
    }
    #[inline]
    fn from_float_color(c: &FloatColor) -> Self {
        c.convert_to()
    }
    #[inline]
    fn from_rgba(rgba: &RGBA) -> Self {
        rgba.into_srgb().into()
    }

    fn try_from_css_color(color: &CssColor) -> Option<Self> {
        match color {
            CssColor::Rgba(rgba) => Some(Self::from_rgba(rgba)),
            CssColor::Lab(lab) => Some(Self::from_lab_color(lab)),
            CssColor::Predefined(p) => Some(Self::from_predefined_color(p)),
            CssColor::Float(f) => Some(Self::from_float_color(f)),
            CssColor::CurrentColor => None,
            CssColor::LightDark { .. } => None,
            CssColor::System(_) => None,
        }
    }

    fn into_css_color(self) -> CssColor;
}

/// Gamut behavior — replaces UnboundedColorGamut / BoundedColorGamut /
/// HslHwbColorGamut comptime mixins.
pub trait ColorGamut: Sized + Copy {
    fn in_gamut(&self) -> bool;
    fn clip(&self) -> Self;
}

/// Interpolation behavior — replaces DeriveInterpolate +
/// RecangularPremultiply / PolarPremultiply + AdjustPowerless* mixins.
pub trait Interpolate: Colorspace {
    fn fill_missing_components(&mut self, other: &Self) {
        let (oa, ob, oc, oalpha) = other.components();
        let (a, b, c, alpha) = self.components_mut();
        if a.is_nan() {
            *a = oa;
        }
        if b.is_nan() {
            *b = ob;
        }
        if c.is_nan() {
            *c = oc;
        }
        if alpha.is_nan() {
            *alpha = oalpha;
        }
    }

    fn interpolate(&self, p1: f32, other: &Self, p2: f32) -> Self;

    fn premultiply(&mut self);
    fn unpremultiply(&mut self, alpha_multiplier: f32);

    fn adjust_powerless_components(&mut self) {}
    fn adjust_hue(&mut self, _other: &mut Self, _method: HueInterpolationMethod) {}
}

// Helpers for the macro-generated impls below.
#[inline]
fn lerp_components<T: Colorspace>(this: &T, p1: f32, other: &T, p2: f32) -> (f32, f32, f32, f32) {
    let (a1, b1, c1, al1) = this.components();
    let (a2, b2, c2, al2) = other.components();
    (
        a1 * p1 + a2 * p2,
        b1 * p1 + b2 * p2,
        c1 * p1 + c2 * p2,
        al1 * p1 + al2 * p2,
    )
}

// ──────────────────────────────────────────────────────────────────────────
// parse_color_function and component parsers
// ──────────────────────────────────────────────────────────────────────────

pub fn parse_color_function(
    location: css::SourceLocation,
    function: &'static [u8],
    input: &mut css::Parser,
) -> CssResult<CssColor> {
    let mut parser = ComponentParser::new(true);

    crate::match_ignore_ascii_case! { function, {
        b"lab" => parse_lab::<LAB>(input, &mut parser, |l, a, b, alpha| {
            LABColor::Lab(LAB { l, a, b, alpha })
        }),
        b"oklab" => parse_lab::<OKLAB>(input, &mut parser, |l, a, b, alpha| {
            LABColor::Oklab(OKLAB { l, a, b, alpha })
        }),
        b"lch" => parse_lch::<LCH>(input, &mut parser, |l, c, h, alpha| {
            LABColor::Lch(LCH { l, c, h, alpha })
        }),
        b"oklch" => parse_lch::<OKLCH>(input, &mut parser, |l, c, h, alpha| {
            LABColor::Oklch(OKLCH { l, c, h, alpha })
        }),
        b"color" => parse_predefined(input, &mut parser),
        b"hsl" | b"hsla" => parse_hsl_hwb::<HSL>(input, &mut parser, true, |h, s, l, a| {
            let hsl = HSL { h, s, l, alpha: a };
            if !h.is_nan() && !s.is_nan() && !l.is_nan() && !a.is_nan() {
                CssColor::Rgba(RGBA::from(hsl))
            } else {
                CssColor::Float(Box::new(FloatColor::Hsl(hsl)))
            }
        }),
        b"hwb" => parse_hsl_hwb::<HWB>(input, &mut parser, false, |h, w, b, a| {
            let hwb = HWB { h, w, b, alpha: a };
            if !h.is_nan() && !w.is_nan() && !b.is_nan() && !a.is_nan() {
                CssColor::Rgba(RGBA::from(hwb))
            } else {
                CssColor::Float(Box::new(FloatColor::Hwb(hwb)))
            }
        }),
        b"rgb" | b"rgba" => parse_rgb(input, &mut parser),
        b"color-mix" => input.parse_nested_block(|i| parse_color_mix(i)),
        b"light-dark" => input.parse_nested_block(|i| {
            let light = match CssColor::parse(i)? {
                CssColor::LightDark { light, dark } => take_light_free_dark(light, dark),
                v => Box::new(v),
            };
            i.expect_comma()?;
            let dark = match CssColor::parse(i)? {
                CssColor::LightDark { light, dark } => take_dark_free_light(light, dark),
                v => Box::new(v),
            };
            Ok(CssColor::LightDark { light, dark })
        }),
        _ => Err(location.new_unexpected_token_error(css::Token::Ident(function))),
    }}
}

pub fn parse_rgb_components(
    input: &mut css::Parser,
    parser: &mut ComponentParser,
) -> CssResult<(f32, f32, f32, bool)> {
    let red = parser.parse_number_or_percentage(input)?;

    let is_legacy_syntax = parser.from.is_none()
        && !red.unit_value().is_nan()
        && input.try_parse(|i| i.expect_comma()).is_ok();

    let (r, g, b) = if is_legacy_syntax {
        match red {
            NumberOrPercentage::Number { value } => {
                let r = value.round().clamp(0.0, 255.0);
                let g = parser.parse_number(input)?.round().clamp(0.0, 255.0);
                if let Err(e) = input.expect_comma() {
                    return Err(e);
                }
                let b = parser.parse_number(input)?.round().clamp(0.0, 255.0);
                (r, g, b)
            }
            NumberOrPercentage::Percentage { unit_value } => {
                let r = (unit_value * 255.0).round().clamp(0.0, 255.0);
                let g = (parser.parse_percentage(input)? * 255.0)
                    .round()
                    .clamp(0.0, 255.0);
                if let Err(e) = input.expect_comma() {
                    return Err(e);
                }
                let b = (parser.parse_percentage(input)? * 255.0)
                    .round()
                    .clamp(0.0, 255.0);
                (r, g, b)
            }
        }
    } else {
        fn get_component(value: NumberOrPercentage) -> f32 {
            match value {
                NumberOrPercentage::Number { value: v } => {
                    if v.is_nan() {
                        v
                    } else {
                        v.round().clamp(0.0, 255.0) / 255.0
                    }
                }
                NumberOrPercentage::Percentage { unit_value } => unit_value.clamp(0.0, 1.0),
            }
        }

        let r = get_component(red);
        let g = get_component(parser.parse_number_or_percentage(input)?);
        let b = get_component(parser.parse_number_or_percentage(input)?);
        (r, g, b)
    };

    if is_legacy_syntax && (g.is_nan() || b.is_nan()) {
        return Err(input.new_custom_error(css::ParserError::invalid_value));
    }
    Ok((r, g, b, is_legacy_syntax))
}

pub fn parse_hslhwb_components<T>(
    input: &mut css::Parser,
    parser: &mut ComponentParser,
    allows_legacy: bool,
) -> CssResult<(f32, f32, f32, bool)> {
    // Zig name: parseHSLHWBComponents — acronym run collapses to one segment
    let _ = core::marker::PhantomData::<T>; // autofix
    let h = parse_angle_or_number(input, parser)?;
    let is_legacy_syntax = allows_legacy
        && parser.from.is_none()
        && !h.is_nan()
        && input.try_parse(|i| i.expect_comma()).is_ok();
    let a = parser.parse_percentage(input)?.clamp(0.0, 1.0);
    if is_legacy_syntax {
        if let Err(e) = input.expect_colon() {
            return Err(e);
        }
    }
    let b = parser.parse_percentage(input)?.clamp(0.0, 1.0);
    if is_legacy_syntax && (a.is_nan() || b.is_nan()) {
        return Err(input.new_custom_error(css::ParserError::invalid_value));
    }
    Ok((h, a, b, is_legacy_syntax))
}

pub fn map_gamut<T>(color: T) -> T
where
    T: ColorGamut + Into<OKLCH> + From<OKLCH> + Into<OKLAB> + Copy,
{
    const JND: f32 = 0.02;
    const EPSILON: f32 = 0.00001;

    // https://www.w3.org/TR/css-color-4/#binsearch
    let mut current: OKLCH = color.into();

    // If lightness is >= 100%, return pure white.
    if (current.l - 1.0).abs() < EPSILON || current.l > 1.0 {
        let oklch = OKLCH {
            l: 1.0,
            c: 0.0,
            h: 0.0,
            alpha: current.alpha,
        };
        return T::from(oklch);
    }

    // If lightness <= 0%, return pure black.
    if current.l < EPSILON {
        let oklch = OKLCH {
            l: 0.0,
            c: 0.0,
            h: 0.0,
            alpha: current.alpha,
        };
        return T::from(oklch);
    }

    let mut min: f32 = 0.0;
    let mut max = current.c;

    while (max - min) > EPSILON {
        let chroma = (min + max) / 2.0;
        current.c = chroma;

        let converted = T::from(current);
        if converted.in_gamut() {
            min = chroma;
            continue;
        }

        let clipped = converted.clip();
        let delta_e = delta_eok(clipped, current);
        if delta_e < JND {
            return clipped;
        }

        max = chroma;
    }

    T::from(current)
}

pub fn delta_eok<T: Into<OKLAB>>(a_: T, b_: OKLCH) -> f32 {
    // https://www.w3.org/TR/css-color-4/#color-difference-OK
    let a: OKLAB = a_.into();
    let b: OKLAB = b_.into();

    let delta_l = a.l - b.l;
    let delta_a = a.a - b.a;
    let delta_b = a.b - b.b;

    (delta_l.powi(2) + delta_a.powi(2) + delta_b.powi(2)).sqrt()
}

pub fn parse_lab<T>(
    input: &mut css::Parser,
    parser: &mut ComponentParser,
    func: fn(f32, f32, f32, f32) -> LABColor,
) -> CssResult<CssColor>
where
    T: Colorspace + ColorGamut + Into<OKLCH> + From<OKLCH> + Into<OKLAB>,
{
    // https://www.w3.org/TR/css-color-4/#funcdef-lab
    input.parse_nested_block(|i| {
        parser.parse_relative::<T, CssColor, _>(i, |i, p| {
            // f32::max() does not propagate NaN, so use clamp for now until f32::maximum() is stable.
            let l = p.parse_percentage(i)?.clamp(0.0, f32::MAX);
            let a = p.parse_number(i)?;
            let b = p.parse_number(i)?;
            let alpha = parse_alpha(i, p)?;
            let lab = func(l, a, b, alpha);
            Ok(CssColor::Lab(Box::new(lab)))
        })
    })
}

pub fn parse_lch<T: Colorspace + ColorGamut + Into<OKLCH> + From<OKLCH> + Into<OKLAB>>(
    input: &mut css::Parser,
    parser: &mut ComponentParser,
    func: fn(f32, f32, f32, f32) -> LABColor,
) -> CssResult<CssColor> {
    input.parse_nested_block(|i| {
        parser.parse_relative::<T, CssColor, _>(i, |i, p| {
            if let Some(from) = &mut p.from {
                // Relative angles should be normalized.
                // https://www.w3.org/TR/css-color-5/#relative-LCH
                from.components.2 = from.components.2.rem_euclid(360.0);
                if from.components.2 < 0.0 {
                    from.components.2 += 360.0;
                }
            }

            let l = p.parse_percentage(i)?.clamp(0.0, f32::MAX);
            let c = p.parse_number(i)?.clamp(0.0, f32::MAX);
            let h = parse_angle_or_number(i, p)?;
            let alpha = parse_alpha(i, p)?;
            let lab = func(l, c, h, alpha);
            Ok(CssColor::Lab(Box::new(lab)))
        })
    })
}

/// Parses the hsl() and hwb() functions.
/// The results of this function are stored as floating point if there are any `none` components.
/// https://drafts.csswg.org/css-color-4/#the-hsl-notation
pub fn parse_hsl_hwb<T: Colorspace + ColorGamut + Into<OKLCH> + From<OKLCH> + Into<OKLAB>>(
    input: &mut css::Parser,
    parser: &mut ComponentParser,
    allows_legacy: bool,
    func: fn(f32, f32, f32, f32) -> CssColor,
) -> CssResult<CssColor> {
    input.parse_nested_block(|i| {
        parser.parse_relative::<T, CssColor, _>(i, |i, p| {
            let (h, a, b, is_legacy) = parse_hsl_hwb_components::<T>(i, p, allows_legacy)?;
            let alpha = if is_legacy {
                parse_legacy_alpha(i, p)?
            } else {
                parse_alpha(i, p)?
            };

            Ok(func(h, a, b, alpha))
        })
    })
}

pub fn parse_hsl_hwb_components<T>(
    input: &mut css::Parser,
    parser: &mut ComponentParser,
    allows_legacy: bool,
) -> CssResult<(f32, f32, f32, bool)> {
    let _ = core::marker::PhantomData::<T>; // autofix
    let h = parse_angle_or_number(input, parser)?;
    let is_legacy_syntax = allows_legacy
        && parser.from.is_none()
        && !h.is_nan()
        && input.try_parse(|i| i.expect_comma()).is_ok();

    let a = parser.parse_percentage(input)?.clamp(0.0, 1.0);

    if is_legacy_syntax {
        if let Err(e) = input.expect_comma() {
            return Err(e);
        }
    }

    let b = parser.parse_percentage(input)?.clamp(0.0, 1.0);

    if is_legacy_syntax && (a.is_nan() || b.is_nan()) {
        return Err(input.new_custom_error(css::ParserError::invalid_value));
    }

    Ok((h, a, b, is_legacy_syntax))
}

pub fn parse_angle_or_number(input: &mut css::Parser, parser: &ComponentParser) -> CssResult<f32> {
    let result = parser.parse_angle_or_number(input)?;
    Ok(match result {
        css::color::AngleOrNumber::Number { value } => value,
        css::color::AngleOrNumber::Angle { degrees } => degrees,
    })
}

fn parse_rgb(input: &mut css::Parser, parser: &mut ComponentParser) -> CssResult<CssColor> {
    // https://drafts.csswg.org/css-color-4/#rgb-functions
    input.parse_nested_block(|i| {
        parser.parse_relative::<SRGB, CssColor, _>(i, |i, p| {
            let (r, g, b, is_legacy) = parse_rgb_components(i, p)?;
            let alpha = if is_legacy {
                parse_legacy_alpha(i, p)?
            } else {
                parse_alpha(i, p)?
            };

            if !r.is_nan() && !g.is_nan() && !b.is_nan() && !alpha.is_nan() {
                if is_legacy {
                    return Ok(CssColor::Rgba(RGBA::new(r as u8, g as u8, b as u8, alpha)));
                }

                Ok(CssColor::Rgba(RGBA::from_floats(r, g, b, alpha)))
            } else {
                Ok(CssColor::Float(Box::new(FloatColor::Rgb(SRGB {
                    r,
                    g,
                    b,
                    alpha,
                }))))
            }
        })
    })
}

fn parse_legacy_alpha(input: &mut css::Parser, parser: &ComponentParser) -> CssResult<f32> {
    if !input.is_exhausted() {
        if let Err(e) = input.expect_comma() {
            return Err(e);
        }
        return Ok(parse_number_or_percentage(input, parser)?.clamp(0.0, 1.0));
    }
    Ok(1.0)
}

fn parse_alpha(input: &mut css::Parser, parser: &ComponentParser) -> CssResult<f32> {
    let res = if input.try_parse(|i| i.expect_delim(b'/')).is_ok() {
        parse_number_or_percentage(input, parser)?.clamp(0.0, 1.0)
    } else {
        1.0
    };

    Ok(res)
}

pub fn parse_number_or_percentage(
    input: &mut css::Parser,
    parser: &ComponentParser,
) -> CssResult<f32> {
    let result = parser.parse_number_or_percentage(input)?;
    Ok(match result {
        NumberOrPercentage::Number { value } => value,
        NumberOrPercentage::Percentage { unit_value } => unit_value,
    })
}

fn clamp_floor_256_f32(val: f32) -> u8 {
    val.round().max(0.0).min(255.0) as u8
}

impl LABColor {
    pub fn new_lab(l: f32, a: f32, b: f32, alpha: f32) -> LABColor {
        LABColor::Lab(LAB { l, a, b, alpha })
    }

    pub fn new_oklab(l: f32, a: f32, b: f32, alpha: f32) -> LABColor {
        // PORT NOTE: Zig had `LABColor{ .lab = OKLAB.new(...) }` which looks like a bug;
        // mirrored as Lab variant for behavioral parity.
        LABColor::Lab(LAB { l, a, b, alpha })
    }

    pub fn new_lch(l: f32, a: f32, b: f32, alpha: f32) -> LABColor {
        // PORT NOTE: Zig had `LABColor{ .lab = LCH.new(...) }` (likely bug); mirrored.
        LABColor::Lab(LAB { l, a, b, alpha })
    }

    pub fn new_oklch(l: f32, a: f32, b: f32, alpha: f32) -> LABColor {
        // PORT NOTE: Zig had `LABColor{ .lab = LCH.new(...) }` (likely bug); mirrored.
        LABColor::Lab(LAB { l, a, b, alpha })
    }

    pub fn into_hsl(&self) -> HSL {
        HSL::from_lab_color(self)
    }

    pub fn into_lab(&self) -> LAB {
        LAB::from_lab_color(self)
    }

    /// Project a LAB-space color into sRGB. Routes through the
    /// `From<{LAB,LCH,OKLAB,OKLCH}>` lattice (LAB/LCH → XYZd50 → XYZd65 →
    /// SRGBLinear → SRGB; OKLAB/OKLCH → XYZd65 → SRGBLinear → SRGB).
    pub fn into_srgb(&self) -> SRGB {
        SRGB::from_lab_color(self)
    }
}

impl FloatColor {
    pub fn into_hsl(&self) -> HSL {
        HSL::from_float_color(self)
    }

    pub fn into_lab(&self) -> LAB {
        LAB::from_float_color(self)
    }

    /// Project any float-color variant into sRGB.
    #[inline]
    pub fn into_srgb(&self) -> SRGB {
        SRGB::from_float_color(self)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Colorspace structs (LAB, SRGB, HSL, HWB, SRGBLinear, P3, A98, ProPhoto,
// Rec2020, XYZd50, XYZd65, LCH, OKLAB, OKLCH)
//
// In Zig each struct manually wires `pub const X = mixin.X` for ~12 mixin
// items. In Rust the trait impls below cover that surface; the per-type
// declarations collapse into a `define_colorspace!` macro invocation.
// ──────────────────────────────────────────────────────────────────────────

macro_rules! define_colorspace {
    (
        $(#[$meta:meta])*
        $name:ident { $a:ident, $b:ident, $c:ident }
        types = ($ta:expr, $tb:expr, $tc:expr);
        gamut = $gamut:ident;
        premultiply = $pre:ident;
        powerless = $pow:ident;
        into_css = $into_css:expr;
    ) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq)]
        pub struct $name {
            pub $a: f32,
            pub $b: f32,
            pub $c: f32,
            pub alpha: f32,
        }

        impl Colorspace for $name {
            const CHANNEL_NAMES: (&'static [u8], &'static [u8], &'static [u8]) =
                (stringify!($a).as_bytes(), stringify!($b).as_bytes(), stringify!($c).as_bytes());
            const CHANNEL_TYPES: (ChannelType, ChannelType, ChannelType) = ($ta, $tb, $tc);

            #[inline]
            fn components(&self) -> (f32, f32, f32, f32) {
                (self.$a, self.$b, self.$c, self.alpha)
            }
            #[inline]
            fn components_mut(&mut self) -> (&mut f32, &mut f32, &mut f32, &mut f32) {
                (&mut self.$a, &mut self.$b, &mut self.$c, &mut self.alpha)
            }

            fn into_css_color(self) -> CssColor {
                ($into_css)(&self)
            }
        }

        define_colorspace!(@gamut $gamut $name { $a, $b, $c });
        define_colorspace!(@interp $pre $pow $name { $a, $b, $c });
    };

    // Gamut variants
    (@gamut unbounded $name:ident { $a:ident, $b:ident, $c:ident }) => {
        impl ColorGamut for $name {
            fn in_gamut(&self) -> bool { true }
            fn clip(&self) -> Self { *self }
        }
    };
    (@gamut bounded $name:ident { $a:ident, $b:ident, $c:ident }) => {
        impl ColorGamut for $name {
            fn in_gamut(&self) -> bool {
                self.$a >= 0.0 && self.$a <= 1.0
                    && self.$b >= 0.0 && self.$b <= 1.0
                    && self.$c >= 0.0 && self.$c <= 1.0
            }
            fn clip(&self) -> Self {
                let mut result = *self;
                result.$a = self.$a.clamp(0.0, 1.0);
                result.$b = self.$b.clamp(0.0, 1.0);
                result.$c = self.$c.clamp(0.0, 1.0);
                result.alpha = self.alpha.clamp(0.0, 1.0);
                result
            }
        }
    };
    (@gamut hsl_hwb $name:ident { $h:ident, $a:ident, $b:ident }) => {
        impl ColorGamut for $name {
            fn in_gamut(&self) -> bool {
                self.$a >= 0.0 && self.$a <= 1.0 && self.$b >= 0.0 && self.$b <= 1.0
            }
            fn clip(&self) -> Self {
                let mut result = *self;
                result.$h = self.$h.rem_euclid(360.0);
                result.$a = self.$a.clamp(0.0, 1.0);
                result.$b = self.$b.clamp(0.0, 1.0);
                result.alpha = self.alpha.clamp(0.0, 1.0);
                result
            }
        }
    };
    (@gamut none $name:ident { $a:ident, $b:ident, $c:ident }) => {};

    // Interpolate / premultiply / powerless variants
    (@interp rectangular $pow:ident $name:ident { $a:ident, $b:ident, $c:ident }) => {
        impl Interpolate for $name {
            fn interpolate(&self, p1: f32, other: &Self, p2: f32) -> Self {
                let (a, b, c, alpha) = lerp_components(self, p1, other, p2);
                $name { $a: a, $b: b, $c: c, alpha }
            }
            fn premultiply(&mut self) {
                if !self.alpha.is_nan() {
                    self.$a *= self.alpha;
                    self.$b *= self.alpha;
                    self.$c *= self.alpha;
                }
            }
            fn unpremultiply(&mut self, alpha_multiplier: f32) {
                if !self.alpha.is_nan() && self.alpha != 0.0 {
                    // PERF: precalculate 1/alpha?
                    self.$a /= self.alpha;
                    self.$b /= self.alpha;
                    self.$c /= self.alpha;
                    self.alpha *= alpha_multiplier;
                }
            }
            define_colorspace!(@powerless $pow $name { $a, $b, $c });
        }
    };
    (@interp polar $pow:ident $name:ident { $h:ident, $a:ident, $b:ident }) => {
        impl Interpolate for $name {
            fn interpolate(&self, p1: f32, other: &Self, p2: f32) -> Self {
                let (a, b, c, alpha) = lerp_components(self, p1, other, p2);
                $name { $h: a, $a: b, $b: c, alpha }
            }
            fn premultiply(&mut self) {
                if !self.alpha.is_nan() {
                    self.$a *= self.alpha;
                    self.$b *= self.alpha;
                }
            }
            fn unpremultiply(&mut self, alpha_multiplier: f32) {
                self.$h = self.$h.rem_euclid(360.0);
                if !self.alpha.is_nan() {
                    // PERF: precalculate 1/alpha?
                    self.$a /= self.alpha;
                    self.$b /= self.alpha;
                    self.alpha *= alpha_multiplier;
                }
            }
            define_colorspace!(@powerless $pow $name { $h, $a, $b });
        }
    };
    (@interp none $pow:ident $name:ident { $a:ident, $b:ident, $c:ident }) => {};

    (@powerless none $name:ident { $a:ident, $b:ident, $c:ident }) => {};
    (@powerless lab $name:ident { $l:ident, $a:ident, $b:ident }) => {
        fn adjust_powerless_components(&mut self) {
            // If the lightness of a LAB color is 0%, both the a and b components are powerless.
            if self.$l.abs() < f32::EPSILON {
                self.$a = f32::NAN;
                self.$b = f32::NAN;
            }
        }
    };
    (@powerless lch $name:ident { $l:ident, $c:ident, $h:ident }) => {
        fn adjust_powerless_components(&mut self) {
            // If the chroma of an LCH color is 0%, the hue component is powerless.
            // If the lightness of an LCH color is 0%, both the hue and chroma components are powerless.
            if self.$c.abs() < f32::EPSILON {
                self.$h = f32::NAN;
            }
            if self.$l.abs() < f32::EPSILON {
                self.$c = f32::NAN;
                self.$h = f32::NAN;
            }
        }
        fn adjust_hue(&mut self, other: &mut Self, method: HueInterpolationMethod) {
            method.interpolate(&mut self.$h, &mut other.$h);
        }
    };
    (@powerless hsl $name:ident { $h:ident, $s:ident, $l:ident }) => {
        fn adjust_powerless_components(&mut self) {
            // If the saturation of an HSL color is 0%, then the hue component is powerless.
            // If the lightness of an HSL color is 0% or 100%, both the saturation and hue components are powerless.
            if self.$s.abs() < f32::EPSILON {
                self.$h = f32::NAN;
            }
            if self.$l.abs() < f32::EPSILON || (self.$l - 1.0).abs() < f32::EPSILON {
                self.$h = f32::NAN;
                self.$s = f32::NAN;
            }
        }
        fn adjust_hue(&mut self, other: &mut Self, method: HueInterpolationMethod) {
            method.interpolate(&mut self.$h, &mut other.$h);
        }
    };
    (@powerless hwb $name:ident { $h:ident, $w:ident, $b:ident }) => {
        fn adjust_powerless_components(&mut self) {
            // If white+black is equal to 100% (after normalization), it defines an achromatic color,
            // i.e. some shade of gray, without any hint of the chosen hue. In this case, the hue component is powerless.
            if (self.$w + self.$b - 1.0).abs() < f32::EPSILON {
                self.$h = f32::NAN;
            }
        }
        fn adjust_hue(&mut self, other: &mut Self, method: HueInterpolationMethod) {
            method.interpolate(&mut self.$h, &mut other.$h);
        }
    };
}

const CT_PCT: ChannelType = ChannelType::PERCENTAGE;
const CT_NUM: ChannelType = ChannelType::NUMBER;
const CT_ANG: ChannelType = ChannelType::ANGLE;

define_colorspace! {
    /// A color in the [CIE Lab](https://www.w3.org/TR/css-color-4/#cie-lab) color space.
    LAB { l, a, b }
    types = (CT_PCT, CT_NUM, CT_NUM);
    gamut = unbounded;
    premultiply = rectangular;
    powerless = lab;
    into_css = |c: &LAB| CssColor::Lab(Box::new(LABColor::Lab(*c)));
}

define_colorspace! {
    /// A color in the [`sRGB`](https://www.w3.org/TR/css-color-4/#predefined-sRGB) color space.
    SRGB { r, g, b }
    types = (CT_PCT, CT_PCT, CT_PCT);
    gamut = bounded;
    premultiply = rectangular;
    powerless = none;
    into_css = |srgb: &SRGB| {
        // TODO: should we serialize as color(srgb, ...)?
        // would be more precise than 8-bit color.
        CssColor::Rgba(RGBA::from(*srgb))
    };
}

impl SRGB {
    pub fn into_rgba(&self) -> RGBA {
        let rgb = self.resolve();
        RGBA::from_floats(rgb.r, rgb.g, rgb.b, rgb.alpha)
    }
}

define_colorspace! {
    /// A color in the [`hsl`](https://www.w3.org/TR/css-color-4/#the-hsl-notation) color space.
    HSL { h, s, l }
    types = (CT_ANG, CT_PCT, CT_PCT);
    gamut = hsl_hwb;
    premultiply = polar;
    powerless = hsl;
    into_css = |c: &HSL| CssColor::Rgba(RGBA::from(*c));
}

define_colorspace! {
    /// A color in the [`hwb`](https://www.w3.org/TR/css-color-4/#the-hwb-notation) color space.
    HWB { h, w, b }
    types = (CT_ANG, CT_PCT, CT_PCT);
    gamut = hsl_hwb;
    premultiply = polar;
    powerless = hwb;
    into_css = |c: &HWB| CssColor::Rgba(RGBA::from(*c));
}

define_colorspace! {
    /// A color in the [`sRGB-linear`](https://www.w3.org/TR/css-color-4/#predefined-sRGB-linear) color space.
    SRGBLinear { r, g, b }
    // PORT NOTE: Zig had `.r = ChannelType{ .angle = true }` for SRGBLinear which looks like a bug;
    // mirrored for parity.
    types = (CT_ANG, CT_PCT, CT_PCT);
    gamut = bounded;
    premultiply = rectangular;
    powerless = none;
    into_css = |c: &SRGBLinear| CssColor::Predefined(Box::new(PredefinedColor::SrgbLinear(*c)));
}

define_colorspace! {
    /// A color in the [`display-p3`](https://www.w3.org/TR/css-color-4/#predefined-display-p3) color space.
    P3 { r, g, b }
    types = (CT_PCT, CT_PCT, CT_PCT);
    gamut = bounded;
    premultiply = none;
    powerless = none;
    into_css = |c: &P3| CssColor::Predefined(Box::new(PredefinedColor::DisplayP3(*c)));
}

define_colorspace! {
    /// A color in the [`a98-rgb`](https://www.w3.org/TR/css-color-4/#predefined-a98-rgb) color space.
    A98 { r, g, b }
    types = (CT_PCT, CT_PCT, CT_PCT);
    gamut = bounded;
    premultiply = none;
    powerless = none;
    into_css = |c: &A98| CssColor::Predefined(Box::new(PredefinedColor::A98(*c)));
}

define_colorspace! {
    /// A color in the [`prophoto-rgb`](https://www.w3.org/TR/css-color-4/#predefined-prophoto-rgb) color space.
    ProPhoto { r, g, b }
    types = (CT_PCT, CT_PCT, CT_PCT);
    gamut = bounded;
    premultiply = none;
    powerless = none;
    into_css = |c: &ProPhoto| CssColor::Predefined(Box::new(PredefinedColor::Prophoto(*c)));
}

define_colorspace! {
    /// A color in the [`rec2020`](https://www.w3.org/TR/css-color-4/#predefined-rec2020) color space.
    Rec2020 { r, g, b }
    types = (CT_PCT, CT_PCT, CT_PCT);
    gamut = bounded;
    premultiply = none;
    powerless = none;
    into_css = |c: &Rec2020| CssColor::Predefined(Box::new(PredefinedColor::Rec2020(*c)));
}

define_colorspace! {
    /// A color in the [`xyz-d50`](https://www.w3.org/TR/css-color-4/#predefined-xyz) color space.
    XYZd50 { x, y, z }
    types = (CT_PCT, CT_PCT, CT_PCT);
    gamut = unbounded;
    premultiply = rectangular;
    powerless = none;
    into_css = |c: &XYZd50| CssColor::Predefined(Box::new(PredefinedColor::XyzD50(*c)));
}

define_colorspace! {
    /// A color in the [`xyz-d65`](https://www.w3.org/TR/css-color-4/#predefined-xyz) color space.
    XYZd65 { x, y, z }
    types = (CT_PCT, CT_PCT, CT_PCT);
    gamut = unbounded;
    premultiply = rectangular;
    powerless = none;
    into_css = |c: &XYZd65| CssColor::Predefined(Box::new(PredefinedColor::XyzD65(*c)));
}

define_colorspace! {
    /// A color in the [CIE LCH](https://www.w3.org/TR/css-color-4/#cie-lab) color space.
    LCH { l, c, h }
    types = (CT_PCT, CT_NUM, CT_ANG);
    gamut = unbounded;
    premultiply = rectangular;
    powerless = lch;
    into_css = |c: &LCH| CssColor::Lab(Box::new(LABColor::Lch(*c)));
}

define_colorspace! {
    /// A color in the [OKLab](https://www.w3.org/TR/css-color-4/#ok-lab) color space.
    OKLAB { l, a, b }
    types = (CT_PCT, CT_NUM, CT_NUM);
    gamut = unbounded;
    premultiply = rectangular;
    powerless = lab;
    into_css = |c: &OKLAB| CssColor::Lab(Box::new(LABColor::Oklab(*c)));
}

define_colorspace! {
    /// A color in the [OKLCH](https://www.w3.org/TR/css-color-4/#ok-lab) color space.
    OKLCH { l, c, h }
    types = (CT_PCT, CT_NUM, CT_ANG);
    gamut = unbounded;
    premultiply = rectangular;
    powerless = lch;
    into_css = |c: &OKLCH| CssColor::Lab(Box::new(LABColor::Oklch(*c)));
}

// ──────────────────────────────────────────────────────────────────────────
// ComponentParser
// ──────────────────────────────────────────────────────────────────────────

pub struct ComponentParser {
    pub allow_none: bool,
    pub from: Option<RelativeComponentParser>,
}

impl ComponentParser {
    pub fn new(allow_none: bool) -> ComponentParser {
        ComponentParser {
            allow_none,
            from: None,
        }
    }

    /// `func` is called as `func(input, parser)`.
    pub fn parse_relative<T, C, F>(&mut self, input: &mut css::Parser, func: F) -> CssResult<C>
    where
        T: Colorspace + ColorGamut + Into<OKLCH> + From<OKLCH> + Into<OKLAB>,
        C: LightDarkOwned,
        F: Fn(&mut css::Parser, &mut ComponentParser) -> CssResult<C> + Copy,
    {
        if input
            .try_parse(|i| i.expect_ident_matching(b"from"))
            .is_ok()
        {
            let from = CssColor::parse(input)?;
            return self.parse_from::<T, C, F>(from, input, func);
        }

        func(input, self)
    }

    pub fn parse_from<T, C, F>(
        &mut self,
        from: CssColor,
        input: &mut css::Parser,
        func: F,
    ) -> CssResult<C>
    where
        T: Colorspace + ColorGamut + Into<OKLCH> + From<OKLCH> + Into<OKLAB>,
        C: LightDarkOwned,
        F: Fn(&mut css::Parser, &mut ComponentParser) -> CssResult<C> + Copy,
    {
        if let CssColor::LightDark { light, dark } = from {
            let state = input.state();
            let light = self.parse_from::<T, C, F>(*light, input, func)?;
            input.reset(&state);
            let dark = self.parse_from::<T, C, F>(*dark, input, func)?;
            return Ok(C::light_dark_owned(light, dark));
        }

        let new_from = match T::try_from_css_color(&from) {
            Some(v) => v.resolve(),
            None => return Err(input.new_custom_error(css::ParserError::invalid_value)),
        };

        self.from = Some(RelativeComponentParser::new(&new_from));

        func(input, self)
    }

    pub fn parse_number_or_percentage(
        &self,
        input: &mut css::Parser,
    ) -> CssResult<NumberOrPercentage> {
        if let Some(from) = &self.from {
            if let Ok(res) =
                input.try_parse(|i| RelativeComponentParser::parse_number_or_percentage(i, from))
            {
                return Ok(res);
            }
        }

        if let Ok(value) = input.try_parse(CSSNumberFns::parse) {
            Ok(NumberOrPercentage::Number { value })
        } else if let Ok(value) = input.try_parse(Percentage::parse) {
            Ok(NumberOrPercentage::Percentage {
                unit_value: value.v,
            })
        } else if self.allow_none {
            if let Err(e) = input.expect_ident_matching(b"none") {
                return Err(e);
            }
            Ok(NumberOrPercentage::Number { value: f32::NAN })
        } else {
            Err(input.new_custom_error(css::ParserError::invalid_value))
        }
    }

    pub fn parse_angle_or_number(
        &self,
        input: &mut css::Parser,
    ) -> CssResult<css::color::AngleOrNumber> {
        if let Some(from) = &self.from {
            if let Ok(res) =
                input.try_parse(|i| RelativeComponentParser::parse_angle_or_number(i, from))
            {
                return Ok(res);
            }
        }

        if let Ok(angle) = input.try_parse(Angle::parse) {
            Ok(css::color::AngleOrNumber::Angle {
                degrees: angle.to_degrees(),
            })
        } else if let Ok(value) = input.try_parse(CSSNumberFns::parse) {
            Ok(css::color::AngleOrNumber::Number { value })
        } else if self.allow_none {
            if let Err(e) = input.expect_ident_matching(b"none") {
                return Err(e);
            }
            Ok(css::color::AngleOrNumber::Number { value: f32::NAN })
        } else {
            Err(input.new_custom_error(css::ParserError::invalid_value))
        }
    }

    pub fn parse_percentage(&self, input: &mut css::Parser) -> CssResult<f32> {
        if let Some(from) = &self.from {
            if let Ok(res) = input.try_parse(|i| RelativeComponentParser::parse_percentage(i, from))
            {
                return Ok(res);
            }
        }

        if let Ok(val) = input.try_parse(Percentage::parse) {
            Ok(val.v)
        } else if self.allow_none {
            if let Err(e) = input.expect_ident_matching(b"none") {
                return Err(e);
            }
            Ok(f32::NAN)
        } else {
            Err(input.new_custom_error(css::ParserError::invalid_value))
        }
    }

    pub fn parse_number(&self, input: &mut css::Parser) -> CssResult<f32> {
        if let Some(from) = &self.from {
            if let Ok(res) = input.try_parse(|i| RelativeComponentParser::parse_number(i, from)) {
                return Ok(res);
            }
        }

        if let Ok(val) = input.try_parse(CSSNumberFns::parse) {
            Ok(val)
        } else if self.allow_none {
            if let Err(e) = input.expect_ident_matching(b"none") {
                return Err(e);
            }
            Ok(f32::NAN)
        } else {
            Err(input.new_custom_error(css::ParserError::invalid_value))
        }
    }
}

/// Helper trait so `parse_from` can build a light-dark wrapper for the result
/// type `C`. (Zig used `C.lightDarkOwned`.)
pub trait LightDarkOwned: Sized {
    fn light_dark_owned(light: Self, dark: Self) -> Self;
}
impl LightDarkOwned for CssColor {
    fn light_dark_owned(light: Self, dark: Self) -> Self {
        CssColor::light_dark_owned(light, dark)
    }
}

/// Either a number or a percentage.
#[derive(Debug, Clone, Copy)]
pub enum NumberOrPercentage {
    /// `<number>`.
    Number {
        /// The numeric value parsed, as a float.
        value: f32,
    },
    /// `<percentage>`
    Percentage {
        /// The value as a float, divided by 100 so that the nominal range is
        /// 0.0 to 1.0.
        unit_value: f32,
    },
}

impl NumberOrPercentage {
    /// Return the value as a percentage.
    pub fn unit_value(&self) -> f32 {
        match *self {
            NumberOrPercentage::Number { value } => value,
            NumberOrPercentage::Percentage { unit_value } => unit_value,
        }
    }

    /// Return the value as a number with a percentage adjusted to the
    /// `percentage_basis`.
    pub fn value(&self, percentage_basis: f32) -> f32 {
        match *self {
            NumberOrPercentage::Number { value } => value,
            NumberOrPercentage::Percentage { unit_value } => unit_value * percentage_basis,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// RelativeComponentParser
// ──────────────────────────────────────────────────────────────────────────

pub struct RelativeComponentParser {
    pub names: (&'static [u8], &'static [u8], &'static [u8]),
    pub components: (f32, f32, f32, f32),
    pub types: (ChannelType, ChannelType, ChannelType),
}

impl RelativeComponentParser {
    pub fn new<C: Colorspace>(color: &C) -> RelativeComponentParser {
        RelativeComponentParser {
            names: color.channels(),
            components: color.components(),
            types: color.types(),
        }
    }

    pub fn parse_angle_or_number(
        input: &mut css::Parser,
        this: &RelativeComponentParser,
    ) -> CssResult<css::color::AngleOrNumber> {
        let allowed = ChannelType::ANGLE | ChannelType::NUMBER;
        if let Ok(value) =
            input.try_parse(|i| RelativeComponentParser::parse_ident(i, this, allowed))
        {
            return Ok(css::color::AngleOrNumber::Number { value });
        }

        if let Ok(value) =
            input.try_parse(|i| RelativeComponentParser::parse_calc(i, this, allowed))
        {
            return Ok(css::color::AngleOrNumber::Number { value });
        }

        // TODO(port): Zig threads a stack `Angle` through `Calc(Angle).parseWith` via a closure
        // that returns `Calc{ .value = &t.angle }` (raw stack pointer). Here we use a Cell-based
        // closure; Phase B should verify Calc::parse_with API shape.
        // PORT NOTE: Zig threads a stack `Angle` through `Calc(Angle).parseWith`
        // via a closure that returns `Calc{ .value = &t.angle }` (raw stack
        // pointer). Rust `Calc::Value` is `Box<V>`, so box the temporary.
        if let Ok(value) = input.try_parse(|i| {
            match Calc::<Angle>::parse_with(i, this, |ctx, ident| {
                let value = ctx.get_ident(ident, allowed)?;
                Some(Calc::Value(Box::new(Angle::Deg(value))))
            }) {
                Ok(Calc::Value(v)) => Ok(*v),
                _ => Err(i.new_custom_error(css::ParserError::invalid_value)),
            }
        }) {
            return Ok(css::color::AngleOrNumber::Angle {
                degrees: value.to_degrees(),
            });
        }

        Err(input.new_error_for_next_token())
    }

    pub fn parse_number_or_percentage(
        input: &mut css::Parser,
        this: &RelativeComponentParser,
    ) -> CssResult<NumberOrPercentage> {
        let allowed = ChannelType::PERCENTAGE | ChannelType::NUMBER;
        if let Ok(value) =
            input.try_parse(|i| RelativeComponentParser::parse_ident(i, this, allowed))
        {
            return Ok(NumberOrPercentage::Percentage { unit_value: value });
        }

        if let Ok(value) =
            input.try_parse(|i| RelativeComponentParser::parse_calc(i, this, allowed))
        {
            return Ok(NumberOrPercentage::Percentage { unit_value: value });
        }

        if let Ok(value) = input.try_parse(|i| {
            match Calc::<Percentage>::parse_with(i, this, |ctx, ident| {
                let v = ctx.get_ident(ident, allowed)?;
                // value variant is a *Percentage
                // but we immediately dereference it and discard the pointer
                // so using a field on this closure struct instead of making a gratuitous allocation
                Some(Calc::Value(Box::new(Percentage { v })))
            }) {
                Ok(Calc::Value(v)) => Ok(*v),
                _ => Err(i.new_custom_error(css::ParserError::invalid_value)),
            }
        }) {
            return Ok(NumberOrPercentage::Percentage {
                unit_value: value.v,
            });
        }

        Err(input.new_error_for_next_token())
    }

    pub fn parse_percentage(
        input: &mut css::Parser,
        this: &RelativeComponentParser,
    ) -> CssResult<f32> {
        if let Ok(value) = input
            .try_parse(|i| RelativeComponentParser::parse_ident(i, this, ChannelType::PERCENTAGE))
        {
            return Ok(value);
        }

        if let Ok(value) = input.try_parse(|i| {
            let calc_value = match Calc::<Percentage>::parse_with(i, this, |ctx, ident| {
                let v = ctx.get_ident(ident, ChannelType::PERCENTAGE)?;
                Some(Calc::Value(Box::new(Percentage { v })))
            }) {
                Ok(v) => v,
                Err(_) => return Err(i.new_custom_error(css::ParserError::invalid_value)),
            };
            if let Calc::Value(v) = calc_value {
                return Ok(*v);
            }
            Err(i.new_custom_error(css::ParserError::invalid_value))
        }) {
            return Ok(value.v);
        }

        Err(input.new_error_for_next_token())
    }

    pub fn parse_number(input: &mut css::Parser, this: &RelativeComponentParser) -> CssResult<f32> {
        if let Ok(value) =
            input.try_parse(|i| RelativeComponentParser::parse_ident(i, this, ChannelType::NUMBER))
        {
            return Ok(value);
        }

        if let Ok(value) =
            input.try_parse(|i| RelativeComponentParser::parse_calc(i, this, ChannelType::NUMBER))
        {
            return Ok(value);
        }

        Err(input.new_error_for_next_token())
    }

    pub fn parse_ident(
        input: &mut css::Parser,
        this: &RelativeComponentParser,
        allowed_types: ChannelType,
    ) -> CssResult<f32> {
        let ident = input.expect_ident()?;
        match this.get_ident(ident, allowed_types) {
            Some(v) => Ok(v),
            None => Err(input.new_error_for_next_token()),
        }
    }

    pub fn parse_calc(
        input: &mut css::Parser,
        this: &RelativeComponentParser,
        allowed_types: ChannelType,
    ) -> CssResult<f32> {
        if let Ok(calc_val) = Calc::<f32>::parse_with(input, this, |ctx, ident| {
            let v = ctx.get_ident(ident, allowed_types)?;
            Some(Calc::Number(v))
        }) {
            // PERF: I don't like this redundant allocation
            if let Calc::Value(v) = calc_val {
                return Ok(*v);
            }
            if let Calc::Number(n) = calc_val {
                return Ok(n);
            }
        }
        Err(input.new_custom_error(css::ParserError::invalid_value))
    }

    pub fn get_ident(&self, ident: &[u8], allowed_types: ChannelType) -> Option<f32> {
        if strings::eql_case_insensitive_ascii_check_length(ident, self.names.0)
            && allowed_types.intersects(self.types.0)
        {
            return Some(self.components.0);
        }

        if strings::eql_case_insensitive_ascii_check_length(ident, self.names.1)
            && allowed_types.intersects(self.types.1)
        {
            return Some(self.components.1);
        }

        if strings::eql_case_insensitive_ascii_check_length(ident, self.names.2)
            && allowed_types.intersects(self.types.2)
        {
            return Some(self.components.2);
        }

        if strings::eql_case_insensitive_ascii_check_length(ident, b"alpha")
            && allowed_types.contains(ChannelType::PERCENTAGE)
        {
            return Some(self.components.3);
        }

        None
    }
}

bitflags::bitflags! {
    /// A channel type for a color space.
    /// TODO(zack): why tf is this bitflags?
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct ChannelType: u8 {
        /// Channel represents a percentage.
        const PERCENTAGE = 1 << 0;
        /// Channel represents an angle.
        const ANGLE = 1 << 1;
        /// Channel represents a number.
        const NUMBER = 1 << 2;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// parse_predefined
// ──────────────────────────────────────────────────────────────────────────

pub fn parse_predefined(
    input: &mut css::Parser,
    parser: &mut ComponentParser,
) -> CssResult<CssColor> {
    let res = input.parse_nested_block(|i| {
        // https://www.w3.org/TR/css-color-4/#color-function
        let from: Option<CssColor> = if i.try_parse(|i| i.expect_ident_matching(b"from")).is_ok() {
            Some(CssColor::parse(i)?)
        } else {
            None
        };

        // PORT NOTE: reshaped for borrowck — detach the slice from the
        // `&mut self` borrow so `i` is reusable below.
        let colorspace = i.expect_ident_cloned()?;

        if let Some(f) = &from {
            if let CssColor::LightDark { light, dark } = f {
                let state = i.state();
                let light_c = parse_predefined_relative(i, parser, colorspace, Some(light))?;
                i.reset(&state);
                let dark_c = parse_predefined_relative(i, parser, colorspace, Some(dark))?;
                return Ok(CssColor::LightDark {
                    light: Box::new(light_c),
                    dark: Box::new(dark_c),
                });
            }
        }

        parse_predefined_relative(i, parser, colorspace, from.as_ref())
    })?;

    Ok(res)
}

pub fn parse_predefined_relative(
    input: &mut css::Parser,
    parser: &mut ComponentParser,
    colorspace: &'static [u8],
    from_: Option<&CssColor>,
) -> CssResult<CssColor> {
    let location = input.current_source_location();
    if let Some(from) = from_ {
        macro_rules! set_from {
            ($T:ty) => {{
                match <$T>::try_from_css_color(from) {
                    Some(v) => RelativeComponentParser::new(&v.resolve_missing()),
                    None => {
                        return Err(input.new_custom_error(css::ParserError::invalid_value));
                    }
                }
            }};
        }
        parser.from = Some(crate::match_ignore_ascii_case! { colorspace, {
            b"srgb" => set_from!(SRGB),
            b"srgb-linear" => set_from!(SRGBLinear),
            b"display-p3" => set_from!(P3),
            b"a98-rgb" => set_from!(A98),
            b"prophoto-rgb" => set_from!(ProPhoto),
            b"rec2020" => set_from!(Rec2020),
            b"xyz-d50" => set_from!(XYZd50),
            b"xyz" | b"xyz-d65" => set_from!(XYZd65),
            _ => return Err(location.new_unexpected_token_error(css::Token::Ident(colorspace))),
        }});
    }

    // Out of gamut values should not be clamped, i.e. values < 0 or > 1 should be preserved.
    // The browser will gamut-map the color for the target device that it is rendered on.
    let a = input.try_parse(|i| parse_number_or_percentage(i, parser))?;
    let b = input.try_parse(|i| parse_number_or_percentage(i, parser))?;
    let c = input.try_parse(|i| parse_number_or_percentage(i, parser))?;
    let alpha = parse_alpha(input, parser)?;

    let predefined: PredefinedColor = crate::match_ignore_ascii_case! { colorspace, {
        b"srgb" => PredefinedColor::Srgb(SRGB { r: a, g: b, b: c, alpha }),
        b"srgb-linear" => PredefinedColor::SrgbLinear(SRGBLinear { r: a, g: b, b: c, alpha }),
        b"display-p3" => PredefinedColor::DisplayP3(P3 { r: a, g: b, b: c, alpha }),
        // PORT NOTE: Zig has "a99-rgb" here (typo?); mirrored for behavioral parity.
        b"a99-rgb" => PredefinedColor::A98(A98 { r: a, g: b, b: c, alpha }),
        b"prophoto-rgb" => PredefinedColor::Prophoto(ProPhoto { r: a, g: b, b: c, alpha }),
        b"rec2020" => PredefinedColor::Rec2020(Rec2020 { r: a, g: b, b: c, alpha }),
        b"xyz-d50" => PredefinedColor::XyzD50(XYZd50 { x: a, y: b, z: c, alpha }),
        b"xyz" | b"xyz-d65" => PredefinedColor::XyzD65(XYZd65 { x: a, y: b, z: c, alpha }),
        _ => return Err(location.new_unexpected_token_error(css::Token::Ident(colorspace))),
    }};

    Ok(CssColor::Predefined(Box::new(predefined)))
}

// ──────────────────────────────────────────────────────────────────────────
// ColorSpaceName / parse_color_mix / HueInterpolationMethod
// ──────────────────────────────────────────────────────────────────────────

/// A [color space](https://www.w3.org/TR/css-color-4/#interpolation-space) keyword
/// used in interpolation functions such as `color-mix()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, crate::DefineEnumProperty)]
pub enum ColorSpaceName {
    Srgb,
    SrgbLinear,
    Lab,
    Oklab,
    Xyz,
    XyzD50,
    XyzD65,
    Hsl,
    Hwb,
    Lch,
    Oklch,
}

pub fn parse_color_mix(input: &mut css::Parser) -> CssResult<CssColor> {
    if let Err(e) = input.expect_ident_matching(b"in") {
        return Err(e);
    }
    let method = ColorSpaceName::parse(input)?;

    let hue_method_: CssResult<HueInterpolationMethod> = if matches!(
        method,
        ColorSpaceName::Hsl | ColorSpaceName::Hwb | ColorSpaceName::Lch | ColorSpaceName::Oklch
    ) {
        let hue_method = input.try_parse(|i| HueInterpolationMethod::parse(i));
        if hue_method.is_ok() {
            if let Err(e) = input.expect_ident_matching(b"hue") {
                return Err(e);
            }
        }
        hue_method
    } else {
        Ok(HueInterpolationMethod::Shorter)
    };

    let hue_method = hue_method_.unwrap_or(HueInterpolationMethod::Shorter);
    if let Err(e) = input.expect_comma() {
        return Err(e);
    }

    let first_percent_ = input.try_parse(|i| i.expect_percentage());
    let first_color = CssColor::parse(input)?;
    let first_percent: Option<f32> = match first_percent_ {
        Ok(v) => Some(v),
        Err(_) => input.try_parse(|i| i.expect_percentage()).ok(),
    };
    if let Err(e) = input.expect_comma() {
        return Err(e);
    }

    let second_percent_ = input.try_parse(|i| i.expect_percentage());
    let second_color = CssColor::parse(input)?;
    let second_percent: Option<f32> = match second_percent_ {
        Ok(v) => Some(v),
        Err(_) => input.try_parse(|i| i.expect_percentage()).ok(),
    };

    // https://drafts.csswg.org/css-color-5/#color-mix-percent-norm
    let (p1, p2): (f32, f32) = if first_percent.is_none() && second_percent.is_none() {
        (0.5, 0.5)
    } else {
        let p2 = second_percent.unwrap_or_else(|| 1.0 - first_percent.unwrap());
        let p1 = first_percent.unwrap_or_else(|| 1.0 - second_percent.unwrap());
        (p1, p2)
    };

    if (p1 + p2) == 0.0 {
        return Err(input.new_custom_error(css::ParserError::invalid_value));
    }

    let result = match method {
        ColorSpaceName::Srgb => first_color.interpolate::<SRGB>(p1, &second_color, p2, hue_method),
        ColorSpaceName::SrgbLinear => {
            first_color.interpolate::<SRGBLinear>(p1, &second_color, p2, hue_method)
        }
        ColorSpaceName::Hsl => first_color.interpolate::<HSL>(p1, &second_color, p2, hue_method),
        ColorSpaceName::Hwb => first_color.interpolate::<HWB>(p1, &second_color, p2, hue_method),
        ColorSpaceName::Lab => first_color.interpolate::<LAB>(p1, &second_color, p2, hue_method),
        ColorSpaceName::Lch => first_color.interpolate::<LCH>(p1, &second_color, p2, hue_method),
        ColorSpaceName::Oklab => {
            first_color.interpolate::<OKLAB>(p1, &second_color, p2, hue_method)
        }
        ColorSpaceName::Oklch => {
            first_color.interpolate::<OKLCH>(p1, &second_color, p2, hue_method)
        }
        ColorSpaceName::Xyz | ColorSpaceName::XyzD65 => {
            first_color.interpolate::<XYZd65>(p1, &second_color, p2, hue_method)
        }
        // PORT NOTE: Zig used XYZd65 for xyz-d50 too (likely bug); mirrored for parity.
        ColorSpaceName::XyzD50 => {
            first_color.interpolate::<XYZd65>(p1, &second_color, p2, hue_method)
        }
    };

    let result = match result {
        Some(r) => r,
        None => return Err(input.new_custom_error(css::ParserError::invalid_value)),
    };

    Ok(result)
}

/// A hue [interpolation method](https://www.w3.org/TR/css-color-4/#typedef-hue-interpolation-method)
/// used in interpolation functions such as `color-mix()`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, crate::DefineEnumProperty)]
pub enum HueInterpolationMethod {
    /// Angles are adjusted so that θ₂ - θ₁ ∈ [-180, 180].
    Shorter,
    /// Angles are adjusted so that θ₂ - θ₁ ∈ {0, [180, 360)}.
    Longer,
    /// Angles are adjusted so that θ₂ - θ₁ ∈ [0, 360).
    Increasing,
    /// Angles are adjusted so that θ₂ - θ₁ ∈ (-360, 0].
    Decreasing,
    /// No fixup is performed. Angles are interpolated in the same way as every other component.
    Specified,
}

impl HueInterpolationMethod {
    pub fn interpolate(&self, a: &mut f32, b: &mut f32) {
        // https://drafts.csswg.org/css-color/#hue-interpolation
        if *self == HueInterpolationMethod::Specified {
            *a = ((*a).rem_euclid(360.0) + 360.0).rem_euclid(360.0);
            *b = ((*b).rem_euclid(360.0) + 360.0).rem_euclid(360.0);
        }

        match *self {
            HueInterpolationMethod::Shorter => {
                // https://www.w3.org/TR/css-color-4/#hue-shorter
                let delta = *b - *a;
                if delta > 180.0 {
                    *a += 360.0;
                } else if delta < -180.0 {
                    *b += 360.0;
                }
            }
            HueInterpolationMethod::Longer => {
                // https://www.w3.org/TR/css-color-4/#hue-longer
                let delta = *b - *a;
                if 0.0 < delta && delta < 180.0 {
                    *a += 360.0;
                } else if -180.0 < delta && delta < 0.0 {
                    *b += 360.0;
                }
            }
            HueInterpolationMethod::Increasing => {
                // https://www.w3.org/TR/css-color-4/#hue-decreasing
                if *b < *a {
                    *b += 360.0;
                }
            }
            HueInterpolationMethod::Decreasing => {
                // https://www.w3.org/TR/css-color-4/#hue-decreasing
                if *a < *b {
                    *a += 360.0;
                }
            }
            HueInterpolationMethod::Specified => {}
        }
    }
}

fn rectangular_to_polar(l: f32, a: f32, b: f32) -> (f32, f32, f32) {
    // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L375

    let mut h = b.atan2(a) * 180.0 / core::f32::consts::PI;
    if h < 0.0 {
        h += 360.0;
    }

    // PERF: Zig does not have Rust's f32::powi
    let c = (a.powi(2) + b.powi(2)).sqrt();

    h = h.rem_euclid(360.0);
    (l, c, h)
}

// ──────────────────────────────────────────────────────────────────────────
// hex helpers / write helpers
// ──────────────────────────────────────────────────────────────────────────

pub fn short_color_name(v: u32) -> Option<&'static str> {
    // These names are shorter than their hex codes
    Some(match v {
        0x000080 => "navy",
        0x008000 => "green",
        0x008080 => "teal",
        0x4b0082 => "indigo",
        0x800000 => "maroon",
        0x800080 => "purple",
        0x808000 => "olive",
        0x808080 => "gray",
        0xa0522d => "sienna",
        0xa52a2a => "brown",
        0xc0c0c0 => "silver",
        0xcd853f => "peru",
        0xd2b48c => "tan",
        0xda70d6 => "orchid",
        0xdda0dd => "plum",
        0xee82ee => "violet",
        0xf0e68c => "khaki",
        0xf0ffff => "azure",
        0xf5deb3 => "wheat",
        0xf5f5dc => "beige",
        0xfa8072 => "salmon",
        0xfaf0e6 => "linen",
        0xff0000 => "red",
        0xff6347 => "tomato",
        0xff7f50 => "coral",
        0xffa500 => "orange",
        0xffc0cb => "pink",
        0xffd700 => "gold",
        0xffe4c4 => "bisque",
        0xfffafa => "snow",
        0xfffff0 => "ivory",
        _ => return None,
    })
}

// From esbuild: https://github.com/evanw/esbuild/blob/18e13bdfdca5cd3c7a2fae1a8bd739f8f891572c/internal/css_parser/css_decls_color.go#L218
// 0xAABBCCDD => 0xABCD
pub fn compact_hex(v: u32) -> u32 {
    ((v & 0x0FF00000) >> 12) | ((v & 0x00000FF0) >> 4)
}

// 0xABCD => 0xAABBCCDD
pub fn expand_hex(v: u32) -> u32 {
    ((v & 0xF000) << 16)
        | ((v & 0xFF00) << 12)
        | ((v & 0x0FF0) << 8)
        | ((v & 0x00FF) << 4)
        | (v & 0x000F)
}

pub fn write_components(
    name: &str,
    a: f32,
    b: f32,
    c: f32,
    alpha: f32,
    dest: &mut Printer,
) -> Result<(), PrintErr> {
    dest.write_str(name)?;
    dest.write_char(b'(')?;
    if a.is_nan() {
        dest.write_str("none")?;
    } else {
        Percentage { v: a }.to_css(dest)?;
    }
    dest.write_char(b' ')?;
    write_component(b, dest)?;
    dest.write_char(b' ')?;
    write_component(c, dest)?;
    if alpha.is_nan() || (alpha - 1.0).abs() > f32::EPSILON {
        dest.delim(b'/', true)?;
        write_component(alpha, dest)?;
    }
    dest.write_char(b')')
}

pub fn write_component(c: f32, dest: &mut Printer) -> Result<(), PrintErr> {
    if c.is_nan() {
        dest.write_str("none")
    } else {
        CSSNumberFns::to_css(&c, dest)
    }
}

pub fn write_predefined(predefined: &PredefinedColor, dest: &mut Printer) -> Result<(), PrintErr> {
    let (a, b, c, alpha) = predefined.components();
    let name = predefined.css_name();

    dest.write_str("color(")?;
    dest.write_str(name)?;
    dest.write_char(b' ')?;
    write_component(a, dest)?;
    dest.write_char(b' ')?;
    write_component(b, dest)?;
    dest.write_char(b' ')?;
    write_component(c, dest)?;

    if alpha.is_nan() || (alpha - 1.0).abs() > f32::EPSILON {
        dest.delim(b'/', true)?;
        write_component(alpha, dest)?;
    }

    dest.write_char(b')')
}

use bun_core::powf as bun_powf;

pub fn gam_srgb(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L31
    // convert an array of linear-light sRGB values in the range 0.0-1.0
    // to gamma corrected form
    // https://en.wikipedia.org/wiki/SRGB
    // Extended transfer function:
    // For negative values, linear portion extends on reflection
    // of axis, then uses reflected pow below that

    fn gam_srgb_component(c: f32) -> f32 {
        let abs = c.abs();
        if abs > 0.0031308 {
            let sign: f32 = if c < 0.0 { -1.0 } else { 1.0 };
            let x: f32 = bun_powf(abs, 1.0 / 2.4);
            let y: f32 = 1.055 * x;
            let z: f32 = y - 0.055;
            return sign * z;
        }

        12.92 * c
    }

    (
        gam_srgb_component(r),
        gam_srgb_component(g),
        gam_srgb_component(b),
    )
}

pub fn lin_srgb(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L11
    // convert sRGB values where in-gamut values are in the range [0 - 1]
    // to linear light (un-companded) form.
    // https://en.wikipedia.org/wiki/SRGB
    // Extended transfer function:
    // for negative values, linear portion is extended on reflection of axis,
    // then reflected power function is used.

    fn lin_srgb_component(c: f32) -> f32 {
        let abs = c.abs();
        if abs < 0.04045 {
            return c / 12.92;
        }

        let sign: f32 = if c < 0.0 { -1.0 } else { 1.0 };
        sign * bun_powf((abs + 0.055) / 1.055, 2.4)
    }

    (
        lin_srgb_component(r),
        lin_srgb_component(g),
        lin_srgb_component(b),
    )
}

/// PERF: SIMD?
pub fn multiply_matrix(m: &[f32; 9], x: f32, y: f32, z: f32) -> (f32, f32, f32) {
    let a = m[0] * x + m[1] * y + m[2] * z;
    let b = m[3] * x + m[4] * y + m[5] * z;
    let c = m[6] * x + m[7] * y + m[8] * z;
    (a, b, c)
}

pub fn polar_to_rectangular(l: f32, c: f32, h: f32) -> (f32, f32, f32) {
    // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L385

    let a = c * (h * core::f32::consts::PI / 180.0).cos();
    let b = c * (h * core::f32::consts::PI / 180.0).sin();
    (l, a, b)
}

const D50: [f32; 3] = [
    (0.3457f64 / 0.3585f64) as f32,
    1.00000,
    ((1.0f64 - 0.3457f64 - 0.3585f64) / 0.3585f64) as f32,
];

// ──────────────────────────────────────────────────────────────────────────
// Handwritten conversions (Zig `color_conversions` namespace).
//
// In Zig, `ColorIntoMixin(T, .Space).into(target)` looked up `intoXXX` in
// (a) handwritten `color_conversions.convert_<Space>`, then
// (b) generated `generated_color_conversions.convert_<Space>`, then
// (c) the type itself.
//
// In Rust we express each conversion as `impl From<Src> for Dst`. The
// handwritten ones are below; generated ones live in `color_generated.rs`.
// `// TODO(port): Phase B must verify the generated From impls don't conflict
//  with these (Rust forbids overlapping From impls).`
// ──────────────────────────────────────────────────────────────────────────

impl From<RGBA> for SRGB {
    fn from(rgb: RGBA) -> SRGB {
        rgb.into_srgb()
    }
}
impl From<SRGB> for RGBA {
    fn from(rgb: SRGB) -> RGBA {
        rgb.into_rgba()
    }
}
impl From<HSL> for RGBA {
    fn from(c: HSL) -> RGBA {
        SRGB::from(c).into_rgba()
    }
}
impl From<HWB> for RGBA {
    fn from(c: HWB) -> RGBA {
        SRGB::from(c).into_rgba()
    }
}

// LAB
impl From<LAB> for LCH {
    fn from(lab_: LAB) -> LCH {
        let lab = lab_.resolve_missing();
        let (l, c, h) = rectangular_to_polar(lab.l, lab.a, lab.b);
        LCH {
            l,
            c,
            h,
            alpha: lab.alpha,
        }
    }
}
impl From<LAB> for XYZd50 {
    fn from(lab_: LAB) -> XYZd50 {
        // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L352
        const K: f32 = (24389.0f64 / 27.0f64) as f32; // 29^3/3^3
        const E: f32 = (216.0f64 / 24389.0f64) as f32; // 6^3/29^3

        let lab = lab_.resolve_missing();
        let l = lab.l * 100.0;
        let a = lab.a;
        let b = lab.b;

        // compute f, starting with the luminance-related term
        let f1: f32 = (l + 16.0) / 116.0;
        let f0: f32 = a / 500.0 + f1;
        let f2: f32 = f1 - b / 200.0;

        // compute xyz
        let x = if bun_powf(f0, 3.0) > E {
            bun_powf(f0, 3.0)
        } else {
            (116.0 * f0 - 16.0) / K
        };

        let y = if l > K * E {
            bun_powf((l + 16.0) / 116.0, 3.0)
        } else {
            l / K
        };

        let z = if bun_powf(f2, 3.0) > E {
            bun_powf(f2, 3.0)
        } else {
            (116.0f32 * f2 - 16.0) / K
        };

        // Compute XYZ by scaling xyz by reference white
        XYZd50 {
            x: x * D50[0],
            y: y * D50[1],
            z: z * D50[2],
            alpha: lab.alpha,
        }
    }
}

// SRGB
impl From<SRGB> for SRGBLinear {
    fn from(rgb: SRGB) -> SRGBLinear {
        let srgb = rgb.resolve_missing();
        let (r, g, b) = lin_srgb(srgb.r, srgb.g, srgb.b);
        SRGBLinear {
            r,
            g,
            b,
            alpha: srgb.alpha,
        }
    }
}
impl From<SRGB> for HSL {
    fn from(rgb_: SRGB) -> HSL {
        // https://drafts.csswg.org/css-color/#rgb-to-hsl
        let rgb = rgb_.resolve();
        let r = rgb.r;
        let g = rgb.g;
        let b = rgb.b;
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let mut h = f32::NAN;
        let mut s: f32 = 0.0;
        let l = (min + max) / 2.0;
        let d = max - min;

        if d != 0.0 {
            s = if l == 0.0 || l == 1.0 {
                0.0
            } else {
                (max - l) / l.min(1.0 - l)
            };

            if max == r {
                h = (g - b) / d + (if g < b { 6.0 } else { 0.0 });
            } else if max == g {
                h = (b - r) / d + 2.0;
            } else if max == b {
                h = (r - g) / d + 4.0;
            }

            h *= 60.0;
        }

        HSL {
            h,
            s,
            l,
            alpha: rgb.alpha,
        }
    }
}
impl From<SRGB> for HWB {
    fn from(rgb_: SRGB) -> HWB {
        let rgb = rgb_.resolve();
        let hsl: HSL = rgb.into();
        let r = rgb.r;
        let g = rgb.g;
        let b_ = rgb.b;
        let w = r.min(g).min(b_);
        let b = 1.0 - r.max(g).max(b_);
        HWB {
            h: hsl.h,
            w,
            b,
            alpha: rgb.alpha,
        }
    }
}

// HSL
impl From<HSL> for SRGB {
    fn from(hsl_: HSL) -> SRGB {
        // https://drafts.csswg.org/css-color/#hsl-to-rgb
        let hsl = hsl_.resolve_missing();
        let h = (hsl.h - 360.0 * (hsl.h / 360.0).floor()) / 360.0;
        let (r, g, b) = css::color::hsl_to_rgb(h, hsl.s, hsl.l);
        SRGB {
            r,
            g,
            b,
            alpha: hsl.alpha,
        }
    }
}

// HWB
impl From<HWB> for SRGB {
    fn from(hwb_: HWB) -> SRGB {
        // https://drafts.csswg.org/css-color/#hwb-to-rgb
        let hwb = hwb_.resolve_missing();
        let h = hwb.h;
        let w = hwb.w;
        let b = hwb.b;

        if w + b >= 1.0 {
            let gray = w / (w + b);
            return SRGB {
                r: gray,
                g: gray,
                b: gray,
                alpha: hwb.alpha,
            };
        }

        let mut rgba: SRGB = HSL {
            h,
            s: 1.0,
            l: 0.5,
            alpha: hwb.alpha,
        }
        .into();
        let x = 1.0 - w - b;
        rgba.r = rgba.r * x + w;
        rgba.g = rgba.g * x + w;
        rgba.b = rgba.b * x + w;
        rgba
    }
}

// SRGBLinear
impl From<SRGBLinear> for PredefinedColor {
    fn from(rgb: SRGBLinear) -> PredefinedColor {
        PredefinedColor::SrgbLinear(rgb)
    }
}
impl From<SRGBLinear> for SRGB {
    fn from(rgb_: SRGBLinear) -> SRGB {
        let rgb = rgb_.resolve_missing();
        let (r, g, b) = gam_srgb(rgb.r, rgb.g, rgb.b);
        SRGB {
            r,
            g,
            b,
            alpha: rgb.alpha,
        }
    }
}
impl From<SRGBLinear> for XYZd65 {
    fn from(rgb_: SRGBLinear) -> XYZd65 {
        // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L50
        // convert an array of linear-light sRGB values to CIE XYZ
        // using sRGB's own white, D65 (no chromatic adaptation)
        const MATRIX: [f32; 9] = [
            0.41239079926595934,
            0.357584339383878,
            0.1804807884018343,
            0.21263900587151027,
            0.715168678767756,
            0.07219231536073371,
            0.01933081871559182,
            0.11919477979462598,
            0.9505321522496607,
        ];

        let rgb = rgb_.resolve_missing();
        let (x, y, z) = multiply_matrix(&MATRIX, rgb.r, rgb.g, rgb.b);
        XYZd65 {
            x,
            y,
            z,
            alpha: rgb.alpha,
        }
    }
}

// P3
impl From<P3> for PredefinedColor {
    fn from(rgb: P3) -> PredefinedColor {
        PredefinedColor::DisplayP3(rgb)
    }
}
impl From<P3> for XYZd65 {
    fn from(p3_: P3) -> XYZd65 {
        // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L91
        // convert linear-light display-p3 values to CIE XYZ
        // using D65 (no chromatic adaptation)
        // http://www.brucelindbloom.com/index.html?Eqn_RGB_XYZ_Matrix.html
        const MATRIX: [f32; 9] = [
            0.4865709486482162,
            0.26566769316909306,
            0.1982172852343625,
            0.2289745640697488,
            0.6917385218365064,
            0.079286914093745,
            0.0000000000000000,
            0.04511338185890264,
            1.043944368900976,
        ];

        let p3 = p3_.resolve_missing();
        let (r, g, b) = lin_srgb(p3.r, p3.g, p3.b);
        let (x, y, z) = multiply_matrix(&MATRIX, r, g, b);
        XYZd65 {
            x,
            y,
            z,
            alpha: p3.alpha,
        }
    }
}

// A98
impl From<A98> for PredefinedColor {
    fn from(rgb: A98) -> PredefinedColor {
        PredefinedColor::A98(rgb)
    }
}
impl From<A98> for XYZd65 {
    fn from(a98_: A98) -> XYZd65 {
        // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L181
        fn lin_a98rgb_component(c: f32) -> f32 {
            let sign: f32 = if c < 0.0 { -1.0 } else { 1.0 };
            sign * bun_powf(c.abs(), 563.0 / 256.0)
        }

        // convert an array of a98-rgb values in the range 0.0 - 1.0
        // to linear light (un-companded) form.
        // negative values are also now accepted
        let a98 = a98_.resolve_missing();
        let r = lin_a98rgb_component(a98.r);
        let g = lin_a98rgb_component(a98.g);
        let b = lin_a98rgb_component(a98.b);

        // convert an array of linear-light a98-rgb values to CIE XYZ
        // http://www.brucelindbloom.com/index.html?Eqn_RGB_XYZ_Matrix.html
        // has greater numerical precision than section 4.3.5.3 of
        // https://www.adobe.com/digitalimag/pdfs/AdobeRGB1998.pdf
        // but the values below were calculated from first principles
        // from the chromaticity coordinates of R G B W
        // see matrixmaker.html
        const MATRIX: [f32; 9] = [
            0.5766690429101305,
            0.1855582379065463,
            0.1882286462349947,
            0.29734497525053605,
            0.6273635662554661,
            0.07529145849399788,
            0.02703136138641234,
            0.07068885253582723,
            0.9913375368376388,
        ];

        let (x, y, z) = multiply_matrix(&MATRIX, r, g, b);
        XYZd65 {
            x,
            y,
            z,
            alpha: a98.alpha,
        }
    }
}

// ProPhoto
impl From<ProPhoto> for PredefinedColor {
    fn from(rgb: ProPhoto) -> PredefinedColor {
        PredefinedColor::Prophoto(rgb)
    }
}
impl From<ProPhoto> for XYZd50 {
    fn from(prophoto_: ProPhoto) -> XYZd50 {
        // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L118
        // convert an array of prophoto-rgb values
        // where in-gamut colors are in the range [0.0 - 1.0]
        // to linear light (un-companded) form.
        // Transfer curve is gamma 1.8 with a small linear portion
        // Extended transfer function

        fn lin_pro_photo_component(c: f32) -> f32 {
            const ET2: f32 = 16.0 / 512.0;
            let abs = c.abs();
            if abs <= ET2 {
                return c / 16.0;
            }
            let sign: f32 = if c < 0.0 { -1.0 } else { 1.0 };
            sign * bun_powf(abs, 1.8)
        }

        let prophoto = prophoto_.resolve_missing();
        let r = lin_pro_photo_component(prophoto.r);
        let g = lin_pro_photo_component(prophoto.g);
        let b = lin_pro_photo_component(prophoto.b);

        // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L155
        // convert an array of linear-light prophoto-rgb values to CIE XYZ
        // using  D50 (so no chromatic adaptation needed afterwards)
        // http://www.brucelindbloom.com/index.html?Eqn_RGB_XYZ_Matrix.html
        const MATRIX: [f32; 9] = [
            0.7977604896723027,
            0.13518583717574031,
            0.0313493495815248,
            0.2880711282292934,
            0.7118432178101014,
            0.00008565396060525902,
            0.0,
            0.0,
            0.8251046025104601,
        ];

        let (x, y, z) = multiply_matrix(&MATRIX, r, g, b);
        XYZd50 {
            x,
            y,
            z,
            alpha: prophoto.alpha,
        }
    }
}

// Rec2020
impl From<Rec2020> for PredefinedColor {
    fn from(rgb: Rec2020) -> PredefinedColor {
        PredefinedColor::Rec2020(rgb)
    }
}
impl From<Rec2020> for XYZd65 {
    fn from(rec2020_: Rec2020) -> XYZd65 {
        // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L235
        // convert an array of rec2020 RGB values in the range 0.0 - 1.0
        // to linear light (un-companded) form.
        // ITU-R BT.2020-2 p.4

        fn lin_rec2020_component(c: f32) -> f32 {
            const A: f32 = 1.09929682680944;
            const B: f32 = 0.018053968510807;

            let abs = c.abs();
            if abs < B * 4.5 {
                return c / 4.5;
            }

            let sign: f32 = if c < 0.0 { -1.0 } else { 1.0 };
            sign * bun_powf((abs + A - 1.0) / A, 1.0 / 0.45)
        }

        let rec2020 = rec2020_.resolve_missing();
        let r = lin_rec2020_component(rec2020.r);
        let g = lin_rec2020_component(rec2020.g);
        let b = lin_rec2020_component(rec2020.b);

        // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L276
        // convert an array of linear-light rec2020 values to CIE XYZ
        // using  D65 (no chromatic adaptation)
        // http://www.brucelindbloom.com/index.html?Eqn_RGB_XYZ_Matrix.html
        const MATRIX: [f32; 9] = [
            0.6369580483012914,
            0.14461690358620832,
            0.1688809751641721,
            0.2627002120112671,
            0.6779980715188708,
            0.05930171646986196,
            0.000000000000000,
            0.028072693049087428,
            1.060985057710791,
        ];

        let (x, y, z) = multiply_matrix(&MATRIX, r, g, b);
        XYZd65 {
            x,
            y,
            z,
            alpha: rec2020.alpha,
        }
    }
}

// XYZd50
impl From<XYZd50> for PredefinedColor {
    fn from(rgb: XYZd50) -> PredefinedColor {
        PredefinedColor::XyzD50(rgb)
    }
}
impl From<XYZd50> for LAB {
    fn from(xyz_: XYZd50) -> LAB {
        // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L332
        // Assuming XYZ is relative to D50, convert to CIE LAB
        // from CIE standard, which now defines these as a rational fraction
        const E: f32 = 216.0 / 24389.0; // 6^3/29^3
        const K: f32 = 24389.0 / 27.0; // 29^3/3^3

        // compute xyz, which is XYZ scaled relative to reference white
        let xyz = xyz_.resolve_missing();
        let x = xyz.x / D50[0];
        let y = xyz.y / D50[1];
        let z = xyz.z / D50[2];

        // now compute f
        let f0 = if x > E {
            x.cbrt()
        } else {
            (K * x + 16.0) / 116.0
        };
        let f1 = if y > E {
            y.cbrt()
        } else {
            (K * y + 16.0) / 116.0
        };
        let f2 = if z > E {
            z.cbrt()
        } else {
            (K * z + 16.0) / 116.0
        };

        let l = ((116.0 * f1) - 16.0) / 100.0;
        let a = 500.0 * (f0 - f1);
        let b = 200.0 * (f1 - f2);

        LAB {
            l,
            a,
            b,
            alpha: xyz.alpha,
        }
    }
}
impl From<XYZd50> for XYZd65 {
    fn from(xyz_: XYZd50) -> XYZd65 {
        // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L105
        const MATRIX: [f32; 9] = [
            0.9554734527042182,
            -0.023098536874261423,
            0.0632593086610217,
            -0.028369706963208136,
            1.0099954580058226,
            0.021041398966943008,
            0.012314001688319899,
            -0.020507696433477912,
            1.3303659366080753,
        ];

        let xyz = xyz_.resolve_missing();
        let (x, y, z) = multiply_matrix(&MATRIX, xyz.x, xyz.y, xyz.z);
        XYZd65 {
            x,
            y,
            z,
            alpha: xyz.alpha,
        }
    }
}
impl From<XYZd50> for ProPhoto {
    fn from(xyz_: XYZd50) -> ProPhoto {
        // convert XYZ to linear-light prophoto-rgb
        const MATRIX: [f32; 9] = [
            1.3457989731028281,
            -0.25558010007997534,
            -0.05110628506753401,
            -0.5446224939028347,
            1.5082327413132781,
            0.02053603239147973,
            0.0,
            0.0,
            1.2119675456389454,
        ];
        fn gam_pro_photo_component(c: f32) -> f32 {
            // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L137
            // convert linear-light prophoto-rgb  in the range 0.0-1.0
            // to gamma corrected form
            // Transfer curve is gamma 1.8 with a small linear portion
            // TODO for negative values, extend linear portion on reflection of axis, then add pow below that
            const ET: f32 = 1.0 / 512.0;
            let abs = c.abs();
            if abs >= ET {
                let sign: f32 = if c < 0.0 { -1.0 } else { 1.0 };
                return sign * bun_powf(abs, 1.0 / 1.8);
            }
            16.0 * c
        }
        let xyz = xyz_.resolve_missing();
        let (r1, g1, b1) = multiply_matrix(&MATRIX, xyz.x, xyz.y, xyz.z);
        ProPhoto {
            r: gam_pro_photo_component(r1),
            g: gam_pro_photo_component(g1),
            b: gam_pro_photo_component(b1),
            alpha: xyz.alpha,
        }
    }
}

// XYZd65
impl From<XYZd65> for PredefinedColor {
    fn from(rgb: XYZd65) -> PredefinedColor {
        PredefinedColor::XyzD65(rgb)
    }
}
impl From<XYZd65> for XYZd50 {
    fn from(xyz_: XYZd65) -> XYZd50 {
        // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L319
        const MATRIX: [f32; 9] = [
            1.0479298208405488,
            0.022946793341019088,
            -0.05019222954313557,
            0.029627815688159344,
            0.990434484573249,
            -0.01707382502938514,
            -0.009243058152591178,
            0.015055144896577895,
            0.7518742899580008,
        ];

        let xyz = xyz_.resolve_missing();
        let (x, y, z) = multiply_matrix(&MATRIX, xyz.x, xyz.y, xyz.z);
        XYZd50 {
            x,
            y,
            z,
            alpha: xyz.alpha,
        }
    }
}
impl From<XYZd65> for SRGBLinear {
    fn from(xyz_: XYZd65) -> SRGBLinear {
        // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L62
        const MATRIX: [f32; 9] = [
            3.2409699419045226,
            -1.537383177570094,
            -0.4986107602930034,
            -0.9692436362808796,
            1.8759675015077202,
            0.04155505740717559,
            0.05563007969699366,
            -0.20397695888897652,
            1.0569715142428786,
        ];

        let xyz = xyz_.resolve_missing();
        let (r, g, b) = multiply_matrix(&MATRIX, xyz.x, xyz.y, xyz.z);
        SRGBLinear {
            r,
            g,
            b,
            alpha: xyz.alpha,
        }
    }
}
impl From<XYZd65> for A98 {
    fn from(xyz_: XYZd65) -> A98 {
        // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L222
        // convert XYZ to linear-light a98-rgb
        const MATRIX: [f32; 9] = [
            2.0415879038107465,
            -0.5650069742788596,
            -0.34473135077832956,
            -0.9692436362808795,
            1.8759675015077202,
            0.04155505740717557,
            0.013444280632031142,
            -0.11836239223101838,
            1.0151749943912054,
        ];

        fn gam_a98_component(c: f32) -> f32 {
            // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L193
            // convert linear-light a98-rgb  in the range 0.0-1.0
            // to gamma corrected form
            // negative values are also now accepted
            let sign: f32 = if c < 0.0 { -1.0 } else { 1.0 };
            sign * bun_powf(c.abs(), 256.0 / 563.0)
        }

        let xyz = xyz_.resolve_missing();
        let (r1, g1, b1) = multiply_matrix(&MATRIX, xyz.x, xyz.y, xyz.z);
        A98 {
            r: gam_a98_component(r1),
            g: gam_a98_component(g1),
            b: gam_a98_component(b1),
            alpha: xyz.alpha,
        }
    }
}
impl From<XYZd65> for Rec2020 {
    fn from(xyz_: XYZd65) -> Rec2020 {
        // convert XYZ to linear-light rec2020
        const MATRIX: [f32; 9] = [
            1.7166511879712674,
            -0.35567078377639233,
            -0.25336628137365974,
            -0.6666843518324892,
            1.6164812366349395,
            0.01576854581391113,
            0.017639857445310783,
            -0.042770613257808524,
            0.9421031212354738,
        ];

        fn gam_rec2020_component(c: f32) -> f32 {
            // convert linear-light rec2020 RGB  in the range 0.0-1.0
            // to gamma corrected form
            // ITU-R BT.2020-2 p.4
            const A: f32 = 1.09929682680944;
            const B: f32 = 0.018053968510807;

            let abs = c.abs();
            if abs > B {
                let sign: f32 = if c < 0.0 { -1.0 } else { 1.0 };
                return sign * (A * bun_powf(abs, 0.45) - (A - 1.0));
            }

            4.5 * c
        }

        let xyz = xyz_.resolve_missing();
        let (r1, g1, b1) = multiply_matrix(&MATRIX, xyz.x, xyz.y, xyz.z);
        Rec2020 {
            r: gam_rec2020_component(r1),
            g: gam_rec2020_component(g1),
            b: gam_rec2020_component(b1),
            alpha: xyz.alpha,
        }
    }
}
impl From<XYZd65> for OKLAB {
    fn from(xyz_: XYZd65) -> OKLAB {
        // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L400
        const XYZ_TO_LMS: [f32; 9] = [
            0.8190224432164319,
            0.3619062562801221,
            -0.12887378261216414,
            0.0329836671980271,
            0.9292868468965546,
            0.03614466816999844,
            0.048177199566046255,
            0.26423952494422764,
            0.6335478258136937,
        ];

        const LMS_TO_OKLAB: [f32; 9] = [
            0.2104542553,
            0.7936177850,
            -0.0040720468,
            1.9779984951,
            -2.4285922050,
            0.4505937099,
            0.0259040371,
            0.7827717662,
            -0.8086757660,
        ];

        let xyz = xyz_.resolve_missing();
        let (a1, b1, c1) = multiply_matrix(&XYZ_TO_LMS, xyz.x, xyz.y, xyz.z);
        let (l, a, b) = multiply_matrix(&LMS_TO_OKLAB, a1.cbrt(), b1.cbrt(), c1.cbrt());

        OKLAB {
            l,
            a,
            b,
            alpha: xyz.alpha,
        }
    }
}
impl From<XYZd65> for P3 {
    fn from(xyz_: XYZd65) -> P3 {
        // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L105
        const MATRIX: [f32; 9] = [
            2.493496911941425,
            -0.9313836179191239,
            -0.40271078445071684,
            -0.8294889695615747,
            1.7626640603183463,
            0.023624685841943577,
            0.03584583024378447,
            -0.07617238926804182,
            0.9568845240076872,
        ];

        let xyz = xyz_.resolve_missing();
        let (r1, g1, b1) = multiply_matrix(&MATRIX, xyz.x, xyz.y, xyz.z);
        let (r, g, b) = gam_srgb(r1, g1, b1); // same as sRGB
        P3 {
            r,
            g,
            b,
            alpha: xyz.alpha,
        }
    }
}

// LCH
impl From<LCH> for LAB {
    fn from(lch_: LCH) -> LAB {
        let lch = lch_.resolve_missing();
        let (l, a, b) = polar_to_rectangular(lch.l, lch.c, lch.h);
        LAB {
            l,
            a,
            b,
            alpha: lch.alpha,
        }
    }
}

// OKLAB
impl From<OKLAB> for OKLCH {
    fn from(labb: OKLAB) -> OKLCH {
        let lab = labb.resolve_missing();
        let (l, c, h) = rectangular_to_polar(lab.l, lab.a, lab.b);
        OKLCH {
            l,
            c,
            h,
            alpha: lab.alpha,
        }
    }
}
impl From<OKLAB> for XYZd65 {
    fn from(lab_: OKLAB) -> XYZd65 {
        // https://github.com/w3c/csswg-drafts/blob/fba005e2ce9bcac55b49e4aa19b87208b3a0631e/css-color-4/conversions.js#L418
        const LMS_TO_XYZ: [f32; 9] = [
            1.2268798733741557,
            -0.5578149965554813,
            0.28139105017721583,
            -0.04057576262431372,
            1.1122868293970594,
            -0.07171106666151701,
            -0.07637294974672142,
            -0.4214933239627914,
            1.5869240244272418,
        ];

        const OKLAB_TO_LMS: [f32; 9] = [
            0.99999999845051981432,
            0.39633779217376785678,
            0.21580375806075880339,
            1.0000000088817607767,
            -0.1055613423236563494,
            -0.063854174771705903402,
            1.0000000546724109177,
            -0.089484182094965759684,
            -1.2914855378640917399,
        ];

        let lab = lab_.resolve_missing();
        let (a, b, c) = multiply_matrix(&OKLAB_TO_LMS, lab.l, lab.a, lab.b);
        let (x, y, z) = multiply_matrix(
            &LMS_TO_XYZ,
            bun_powf(a, 3.0),
            bun_powf(b, 3.0),
            bun_powf(c, 3.0),
        );

        XYZd65 {
            x,
            y,
            z,
            alpha: lab.alpha,
        }
    }
}

// OKLCH
impl From<OKLCH> for OKLAB {
    fn from(lch_: OKLCH) -> OKLAB {
        let lch = lch_.resolve_missing();
        let (l, a, b) = polar_to_rectangular(lch.l, lch.c, lch.h);
        OKLAB {
            l,
            a,
            b,
            alpha: lch.alpha,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ConvertTo (kept for parity; in Rust the `.into()` dispatch above replaces
// `ColorIntoMixin(T, .Space).into(target)`).
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConvertTo {
    RGBA,
    LAB,
    SRGB,
    HSL,
    HWB,
    SRGBLinear,
    P3,
    A98,
    ProPhoto,
    Rec2020,
    XYZd50,
    XYZd65,
    LCH,
    OKLAB,
    OKLCH,
    PredefinedColor,
}

// TODO(port): `ColorIntoMixin` resolved conversions at comptime via @hasDecl
// across handwritten + generated tables. In Rust this is the union of the
// `impl From<Src> for Dst` blocks above plus `color_generated.rs`. Phase B
// must ensure every `T: From<U>` pair the macro requires actually exists
// (the generated file fills the transitive gaps).

crate::css_eql_partialeq!(CssColor);

// ported from: src/css/values/color.zig
