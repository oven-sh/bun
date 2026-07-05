use crate as css;
use crate::VendorPrefix;

use bun_core;
use bun_core::strings;

/// Target browsers and features to compile.
#[derive(Debug, Clone, Copy, Default)]
pub struct Targets {
    /// Browser targets to compile the CSS for.
    pub browsers: Option<Browsers>,
    /// Features that should always be compiled, even when supported by targets.
    pub include: Features,
    /// Features that should never be compiled, even when unsupported by targets.
    pub exclude: Features,
}

impl Targets {
    /// Set a sane default for bundler
    pub fn browser_default() -> Targets {
        Targets {
            browsers: Some(*BROWSER_DEFAULT),
            ..Default::default()
        }
    }

    /// Set a sane default for bundler
    pub fn runtime_default() -> Targets {
        Targets {
            browsers: None,
            ..Default::default()
        }
    }

    #[cfg(debug_assertions)]
    fn parse_debug_target(val_: &[u8]) -> Option<u32> {
        let val = strings::trim(val_, b" \n\r\t");
        if val.is_empty() {
            return None;
        }
        if strings::eql_case_insensitive_ascii(val, b"null", true) {
            return None;
        }

        let mut lhs: u32 = 0;

        let mut i: usize = 0;
        for (j, &c) in val.iter().enumerate() {
            if !c.is_ascii_digit() {
                i = j;
                lhs = strings::parse_int::<u32>(&val[0..j], 10).expect("invalid bytes");
                break;
            }
        }
        if i >= val.len() {
            lhs = strings::parse_int::<u32>(val, 10).expect("invalid bytes");
            return Some(lhs);
        }
        if val[i] != b' ' {
            panic!("bad string");
        }
        i += 1;
        if val[i] != b'<' || i + 1 >= val.len() || val[i + 1] != b'<' {
            panic!("bad string");
        }
        i += 2;
        if val[i] != b' ' {
            panic!("bad string");
        }
        i += 1;
        let rhs: u32 = strings::parse_int::<u32>(&val[i..], 10).expect("invalid bytes");
        Some(lhs << rhs)
    }

    pub fn for_bundler_target(target: bun_ast::Target) -> Targets {
        #[cfg(debug_assertions)]
        {
            let mut browsers = Browsers::default();
            let mut has_any = false;
            macro_rules! check_field {
                ($field:ident, $env:literal) => {
                    if let Some(val) = bun_core::getenv_z_any_case(bun_core::zstr!($env)) {
                        browsers.$field = Self::parse_debug_target(val);
                        has_any = true;
                    }
                };
            }
            check_field!(android, "BUN_DEBUG_CSS_TARGET_android");
            check_field!(chrome, "BUN_DEBUG_CSS_TARGET_chrome");
            check_field!(edge, "BUN_DEBUG_CSS_TARGET_edge");
            check_field!(firefox, "BUN_DEBUG_CSS_TARGET_firefox");
            check_field!(ie, "BUN_DEBUG_CSS_TARGET_ie");
            check_field!(ios_saf, "BUN_DEBUG_CSS_TARGET_ios_saf");
            check_field!(opera, "BUN_DEBUG_CSS_TARGET_opera");
            check_field!(safari, "BUN_DEBUG_CSS_TARGET_safari");
            check_field!(samsung, "BUN_DEBUG_CSS_TARGET_samsung");
            if has_any {
                return Targets {
                    browsers: Some(browsers),
                    ..Default::default()
                };
            }
        }
        use bun_ast::Target as T;
        match target {
            T::Node | T::Bun => Self::runtime_default(),
            T::Browser | T::BunMacro | T::ServerComponentsSsr => Self::browser_default(),
        }
    }

    pub fn prefixes(&self, prefix: VendorPrefix, feature: css::prefixes::Feature) -> VendorPrefix {
        if prefix.contains(VendorPrefix::NONE) && !self.exclude.contains(Features::VENDOR_PREFIXES)
        {
            if self.include.contains(Features::VENDOR_PREFIXES) {
                VendorPrefix::all()
            } else {
                if let Some(b) = self.browsers {
                    feature.prefixes_for(&b)
                } else {
                    prefix
                }
            }
        } else {
            prefix
        }
    }

    pub fn should_compile_logical(&self, feature: css::compat::Feature) -> bool {
        self.should_compile(feature, Features::LOGICAL_PROPERTIES)
    }

    pub fn should_compile(&self, feature: css::compat::Feature, flag: Features) -> bool {
        self.include.contains(flag)
            || (!self.exclude.contains(flag) && !self.is_compatible(feature))
    }

    pub fn should_compile_same(&self, compat_feature: css::compat::Feature) -> bool {
        // PERF: runtime dispatch (a const-generic param
        // would need #[derive(ConstParamTy)] on compat::Feature).
        let Some(flag) = Features::from_compat(compat_feature) else {
            debug_assert!(
                false,
                "compat::Feature::{:?} has no Features flag",
                compat_feature
            );
            return !self.is_compatible(compat_feature);
        };
        self.should_compile(compat_feature, flag)
    }

    pub fn should_compile_selectors(&self) -> bool {
        self.include.intersects(Features::SELECTORS)
            || (!self.exclude.intersects(Features::SELECTORS) && self.browsers.is_some())
    }

    pub fn is_compatible(&self, feature: css::compat::Feature) -> bool {
        if let Some(targets) = &self.browsers {
            return feature.is_compatible(targets);
        }
        true
    }
}

/// Browser versions to compile CSS for.
///
/// Versions are represented as a single 24-bit integer, with one byte
/// per `major.minor.patch` component.
///
/// # Example
///
/// This example represents a target of Safari 13.2.0.
///
/// ```ignore
/// Browsers {
///   safari: Some((13 << 16) | (2 << 8)),
///   ..Browsers::default()
/// }
/// ```
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Browsers {
    pub android: Option<u32>,
    pub chrome: Option<u32>,
    pub edge: Option<u32>,
    pub firefox: Option<u32>,
    pub ie: Option<u32>,
    pub ios_saf: Option<u32>,
    pub opera: Option<u32>,
    pub safari: Option<u32>,
    pub samsung: Option<u32>,
}

// convert_from_string is not const-evaluable; compute once lazily.
static BROWSER_DEFAULT: std::sync::LazyLock<Browsers> = std::sync::LazyLock::new(|| {
    Browsers::convert_from_string(&[
        b"es2020", // support import.meta.url
        b"edge88",
        b"firefox78",
        b"chrome87",
        b"safari14",
    ])
    .expect("unreachable")
});

impl Browsers {
    /// Ported from here:
    /// https://github.com/vitejs/vite/blob/ac329685bba229e1ff43e3d96324f817d48abe48/packages/vite/src/node/plugins/css.ts#L3335
    pub fn convert_from_string(esbuild_target: &[&[u8]]) -> Result<Browsers, bun_core::Error> {
        let mut browsers = Browsers::default();

        for &str in esbuild_target {
            let mut entries_buf: [&[u8]; 5] = [b""; 5];
            let entries_without_es: &[&[u8]] = 'entries_without_es: {
                if str.len() <= 2 || !(str[0] == b'e' && str[1] == b's') {
                    entries_buf[0] = str;
                    break 'entries_without_es &entries_buf[0..1];
                }

                let number_part = &str[2..];
                // Propagates InvalidCharacter / Overflow. Preserve the tag for
                // error-name snapshot compat (do NOT collapse to UnsupportedCSSTarget).
                let year = strings::parse_int::<u16>(number_part, 10).map_err(|e| match e {
                    strings::ParseIntError::Overflow => bun_core::err!("Overflow"),
                    strings::ParseIntError::InvalidCharacter => {
                        bun_core::err!("InvalidCharacter")
                    }
                })?;
                match year {
                    // https://caniuse.com/?search=es2015
                    2015 => {
                        entries_buf = [
                            b"chrome49",
                            b"edge13",
                            b"safari10",
                            b"firefox44",
                            b"opera36",
                        ];
                        break 'entries_without_es &entries_buf[0..5];
                    }
                    // https://caniuse.com/?search=es2016
                    2016 => {
                        entries_buf = [
                            b"chrome50",
                            b"edge13",
                            b"safari10",
                            b"firefox43",
                            b"opera37",
                        ];
                        break 'entries_without_es &entries_buf[0..5];
                    }
                    // https://caniuse.com/?search=es2017
                    2017 => {
                        entries_buf = [
                            b"chrome58",
                            b"edge15",
                            b"safari11",
                            b"firefox52",
                            b"opera45",
                        ];
                        break 'entries_without_es &entries_buf[0..5];
                    }
                    // https://caniuse.com/?search=es2018
                    2018 => {
                        entries_buf = [
                            b"chrome63",
                            b"edge79",
                            b"safari12",
                            b"firefox58",
                            b"opera50",
                        ];
                        break 'entries_without_es &entries_buf[0..5];
                    }
                    // https://caniuse.com/?search=es2019
                    2019 => {
                        entries_buf = [
                            b"chrome73",
                            b"edge79",
                            b"safari12.1",
                            b"firefox64",
                            b"opera60",
                        ];
                        break 'entries_without_es &entries_buf[0..5];
                    }
                    // https://caniuse.com/?search=es2020
                    2020 => {
                        entries_buf = [
                            b"chrome80",
                            b"edge80",
                            b"safari14.1",
                            b"firefox80",
                            b"opera67",
                        ];
                        break 'entries_without_es &entries_buf[0..5];
                    }
                    // https://caniuse.com/?search=es2021
                    2021 => {
                        entries_buf = [
                            b"chrome85",
                            b"edge85",
                            b"safari14.1",
                            b"firefox80",
                            b"opera71",
                        ];
                        break 'entries_without_es &entries_buf[0..5];
                    }
                    // https://caniuse.com/?search=es2022
                    2022 => {
                        entries_buf = [
                            b"chrome94",
                            b"edge94",
                            b"safari16.4",
                            b"firefox93",
                            b"opera80",
                        ];
                        break 'entries_without_es &entries_buf[0..5];
                    }
                    // https://caniuse.com/?search=es2023
                    2023 => {
                        entries_buf[0..4].copy_from_slice(&[
                            b"chrome110",
                            b"edge110",
                            b"safari16.4",
                            b"opera96",
                        ]);
                        break 'entries_without_es &entries_buf[0..4];
                    }
                    _ => {
                        return Err(bun_core::err!("UnsupportedCSSTarget"));
                    }
                }
            };

            'for_loop: for &entry in entries_without_es {
                if entry == b"esnext" {
                    continue;
                }
                let maybe_idx: Option<usize> = 'maybe_idx: {
                    for (i, &c) in entry.iter().enumerate() {
                        if c.is_ascii_digit() {
                            break 'maybe_idx Some(i);
                        }
                    }
                    break 'maybe_idx None;
                };

                if let Some(idx) = maybe_idx {
                    #[derive(Clone, Copy, PartialEq, Eq)]
                    enum Browser {
                        Chrome,
                        Edge,
                        Firefox,
                        Ie,
                        IosSaf,
                        Opera,
                        Safari,
                        NoMapping,
                    }
                    bun_core::comptime_string_map! {
                        static MAP: Browser = {
                            b"chrome" => Browser::Chrome,
                            b"edge" => Browser::Edge,
                            b"firefox" => Browser::Firefox,
                            b"hermes" => Browser::NoMapping,
                            b"ie" => Browser::Ie,
                            b"ios" => Browser::IosSaf,
                            b"node" => Browser::NoMapping,
                            b"opera" => Browser::Opera,
                            b"rhino" => Browser::NoMapping,
                            b"safari" => Browser::Safari,
                        };
                    }
                    let browser = MAP.get(&entry[0..idx]).copied();
                    let Some(browser) = browser else { continue };
                    if browser == Browser::NoMapping {
                        continue; // No mapping available
                    }

                    let (major, minor) = 'major_minor: {
                        let version_str = &entry[idx..];
                        let dot_index = version_str
                            .iter()
                            .position(|&b| b == b'.')
                            .unwrap_or(version_str.len());
                        let Some(major) =
                            strings::parse_int::<u16>(&version_str[0..dot_index], 10).ok()
                        else {
                            continue 'for_loop;
                        };
                        let minor = if dot_index < version_str.len() {
                            strings::parse_int::<u16>(&version_str[dot_index + 1..], 10)
                                .unwrap_or(0)
                        } else {
                            0
                        };
                        break 'major_minor (major, minor);
                    };

                    let version: u32 = ((major as u32) << 16) | ((minor as u32) << 8);
                    let slot: &mut Option<u32> = match browser {
                        Browser::Chrome => &mut browsers.chrome,
                        Browser::Edge => &mut browsers.edge,
                        Browser::Firefox => &mut browsers.firefox,
                        Browser::Ie => &mut browsers.ie,
                        Browser::IosSaf => &mut browsers.ios_saf,
                        Browser::Opera => &mut browsers.opera,
                        Browser::Safari => &mut browsers.safari,
                        Browser::NoMapping => continue 'for_loop,
                    };
                    if slot.is_none() || version < slot.unwrap() {
                        *slot = Some(version);
                    }
                    continue 'for_loop;
                }
            }
        }

        Ok(browsers)
    }
}

bitflags::bitflags! {
    /// Autogenerated by build-prefixes.js
    /// Features to explicitly enable or disable.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct Features: u32 {
        const NESTING                           = 1 << 0;
        const NOT_SELECTOR_LIST                 = 1 << 1;
        const DIR_SELECTOR                      = 1 << 2;
        const LANG_SELECTOR_LIST                = 1 << 3;
        const IS_SELECTOR                       = 1 << 4;
        const TEXT_DECORATION_THICKNESS_PERCENT = 1 << 5;
        const MEDIA_INTERVAL_SYNTAX             = 1 << 6;
        const MEDIA_RANGE_SYNTAX                = 1 << 7;
        const CUSTOM_MEDIA_QUERIES              = 1 << 8;
        const CLAMP_FUNCTION                    = 1 << 9;
        const COLOR_FUNCTION                    = 1 << 10;
        const OKLAB_COLORS                      = 1 << 11;
        const LAB_COLORS                        = 1 << 12;
        const P3_COLORS                         = 1 << 13;
        const HEX_ALPHA_COLORS                  = 1 << 14;
        const SPACE_SEPARATED_COLOR_NOTATION    = 1 << 15;
        const FONT_FAMILY_SYSTEM_UI             = 1 << 16;
        const DOUBLE_POSITION_GRADIENTS         = 1 << 17;
        const VENDOR_PREFIXES                   = 1 << 18;
        const LOGICAL_PROPERTIES                = 1 << 19;

        const SELECTORS = Self::NESTING.bits()
            | Self::NOT_SELECTOR_LIST.bits()
            | Self::DIR_SELECTOR.bits()
            | Self::LANG_SELECTOR_LIST.bits()
            | Self::IS_SELECTOR.bits();

        const MEDIA_QUERIES = Self::MEDIA_INTERVAL_SYNTAX.bits()
            | Self::MEDIA_RANGE_SYNTAX.bits()
            | Self::CUSTOM_MEDIA_QUERIES.bits();

        const COLORS = Self::COLOR_FUNCTION.bits()
            | Self::OKLAB_COLORS.bits()
            | Self::LAB_COLORS.bits()
            | Self::P3_COLORS.bits()
            | Self::HEX_ALPHA_COLORS.bits()
            | Self::SPACE_SEPARATED_COLOR_NOTATION.bits();
    }
}

impl Default for Features {
    fn default() -> Self {
        Features::empty()
    }
}

impl Features {
    /// Map a `compat::Feature` enum variant to the same-named `Features` bitflag.
    ///
    /// The variant is taken at runtime, so the table is
    /// hand-written: every `compat::Feature` whose snake_case tag matches a
    /// `Features` field gets an arm; any other variant is a programmer error.
    pub fn from_compat(compat_feature: css::compat::Feature) -> Option<Features> {
        use css::compat::Feature;
        match compat_feature {
            Feature::Nesting => Some(Features::NESTING),
            Feature::NotSelectorList => Some(Features::NOT_SELECTOR_LIST),
            Feature::DirSelector => Some(Features::DIR_SELECTOR),
            Feature::LangSelectorList => Some(Features::LANG_SELECTOR_LIST),
            Feature::IsSelector => Some(Features::IS_SELECTOR),
            Feature::TextDecorationThicknessPercent => {
                Some(Features::TEXT_DECORATION_THICKNESS_PERCENT)
            }
            Feature::MediaIntervalSyntax => Some(Features::MEDIA_INTERVAL_SYNTAX),
            Feature::MediaRangeSyntax => Some(Features::MEDIA_RANGE_SYNTAX),
            Feature::CustomMediaQueries => Some(Features::CUSTOM_MEDIA_QUERIES),
            Feature::ClampFunction => Some(Features::CLAMP_FUNCTION),
            Feature::ColorFunction => Some(Features::COLOR_FUNCTION),
            Feature::OklabColors => Some(Features::OKLAB_COLORS),
            Feature::LabColors => Some(Features::LAB_COLORS),
            Feature::P3Colors => Some(Features::P3_COLORS),
            Feature::HexAlphaColors => Some(Features::HEX_ALPHA_COLORS),
            Feature::SpaceSeparatedColorNotation => Some(Features::SPACE_SEPARATED_COLOR_NOTATION),
            Feature::FontFamilySystemUi => Some(Features::FONT_FAMILY_SYSTEM_UI),
            Feature::DoublePositionGradients => Some(Features::DOUBLE_POSITION_GRADIENTS),
            // Every remaining `compat::Feature` has no same-named `Features`
            // flag; the exhaustive arm makes new variants a compile error.
            Feature::AbsFunction
            | Feature::AccentSystemColor
            | Feature::AfarListStyleType
            | Feature::AmharicAbegedeListStyleType
            | Feature::AmharicListStyleType
            | Feature::AnchorSizeSize
            | Feature::AnimationTimelineShorthand
            | Feature::AnyLink
            | Feature::AnyPseudo
            | Feature::ArabicIndicListStyleType
            | Feature::ArmenianListStyleType
            | Feature::AsterisksListStyleType
            | Feature::Autofill
            | Feature::AutoSize
            | Feature::BengaliListStyleType
            | Feature::BinaryListStyleType
            | Feature::BorderImageRepeatRound
            | Feature::BorderImageRepeatSpace
            | Feature::CalcFunction
            | Feature::CambodianListStyleType
            | Feature::CapUnit
            | Feature::CaseInsensitive
            | Feature::ChUnit
            | Feature::CircleListStyleType
            | Feature::CjkDecimalListStyleType
            | Feature::CjkEarthlyBranchListStyleType
            | Feature::CjkHeavenlyStemListStyleType
            | Feature::ConicGradient
            | Feature::ContainerQueryLengthUnits
            | Feature::Cue
            | Feature::CueFunction
            | Feature::DecimalLeadingZeroListStyleType
            | Feature::DecimalListStyleType
            | Feature::DefaultPseudo
            | Feature::DevanagariListStyleType
            | Feature::Dialog
            | Feature::DiscListStyleType
            | Feature::DisclosureClosedListStyleType
            | Feature::DisclosureOpenListStyleType
            | Feature::EmUnit
            | Feature::EthiopicAbegedeAmEtListStyleType
            | Feature::EthiopicAbegedeGezListStyleType
            | Feature::EthiopicAbegedeListStyleType
            | Feature::EthiopicAbegedeTiErListStyleType
            | Feature::EthiopicAbegedeTiEtListStyleType
            | Feature::EthiopicHalehameAaErListStyleType
            | Feature::EthiopicHalehameAaEtListStyleType
            | Feature::EthiopicHalehameAmEtListStyleType
            | Feature::EthiopicHalehameGezListStyleType
            | Feature::EthiopicHalehameOmEtListStyleType
            | Feature::EthiopicHalehameSidEtListStyleType
            | Feature::EthiopicHalehameSoEtListStyleType
            | Feature::EthiopicHalehameTigListStyleType
            | Feature::EthiopicListStyleType
            | Feature::EthiopicNumericListStyleType
            | Feature::ExtendedSystemFonts
            | Feature::ExUnit
            | Feature::FirstLetter
            | Feature::FirstLine
            | Feature::FitContentFunctionSize
            | Feature::FitContentSize
            | Feature::FocusVisible
            | Feature::FocusWithin
            | Feature::FontSizeRem
            | Feature::FontSizeXXXLarge
            | Feature::FontStretchPercentage
            | Feature::FontStyleObliqueAngle
            | Feature::FontWeightNumber
            | Feature::FootnotesListStyleType
            | Feature::FormValidation
            | Feature::Fullscreen
            | Feature::Gencontent
            | Feature::GeorgianListStyleType
            | Feature::GradientInterpolationHints
            | Feature::GujaratiListStyleType
            | Feature::GurmukhiListStyleType
            | Feature::HasSelector
            | Feature::HebrewListStyleType
            | Feature::HiraganaIrohaListStyleType
            | Feature::HiraganaListStyleType
            | Feature::HypotFunction
            | Feature::IcUnit
            | Feature::ImageSet
            | Feature::IndeterminatePseudo
            | Feature::InOutOfRange
            | Feature::IsAnimatableSize
            | Feature::JapaneseFormalListStyleType
            | Feature::JapaneseInformalListStyleType
            | Feature::KannadaListStyleType
            | Feature::KatakanaIrohaListStyleType
            | Feature::KatakanaListStyleType
            | Feature::KhmerListStyleType
            | Feature::KoreanHangulFormalListStyleType
            | Feature::KoreanHanjaFormalListStyleType
            | Feature::KoreanHanjaInformalListStyleType
            | Feature::LaoListStyleType
            | Feature::LhUnit
            | Feature::LightDark
            | Feature::LinearGradient
            | Feature::LogicalBorderRadius
            | Feature::LogicalBorders
            | Feature::LogicalBorderShorthand
            | Feature::LogicalInset
            | Feature::LogicalMargin
            | Feature::LogicalMarginShorthand
            | Feature::LogicalPadding
            | Feature::LogicalPaddingShorthand
            | Feature::LogicalSize
            | Feature::LogicalTextAlign
            | Feature::LowerAlphaListStyleType
            | Feature::LowerArmenianListStyleType
            | Feature::LowerGreekListStyleType
            | Feature::LowerHexadecimalListStyleType
            | Feature::LowerLatinListStyleType
            | Feature::LowerNorwegianListStyleType
            | Feature::LowerRomanListStyleType
            | Feature::MalayalamListStyleType
            | Feature::MarkerPseudo
            | Feature::MaxContentSize
            | Feature::MaxFunction
            | Feature::MinContentSize
            | Feature::MinFunction
            | Feature::ModFunction
            | Feature::MongolianListStyleType
            | Feature::MozAvailableSize
            | Feature::MyanmarListStyleType
            | Feature::Namespaces
            | Feature::NoneListStyleType
            | Feature::NthChildOf
            | Feature::OctalListStyleType
            | Feature::OptionalPseudo
            | Feature::OriyaListStyleType
            | Feature::OromoListStyleType
            | Feature::OverflowShorthand
            | Feature::PartPseudo
            | Feature::PersianListStyleType
            | Feature::PlaceContent
            | Feature::Placeholder
            | Feature::PlaceholderShown
            | Feature::PlaceItems
            | Feature::PlaceSelf
            | Feature::QUnit
            | Feature::RadialGradient
            | Feature::RcapUnit
            | Feature::RchUnit
            | Feature::ReadOnlyWrite
            | Feature::RemFunction
            | Feature::RemUnit
            | Feature::RepeatingConicGradient
            | Feature::RepeatingLinearGradient
            | Feature::RepeatingRadialGradient
            | Feature::RexUnit
            | Feature::RicUnit
            | Feature::RlhUnit
            | Feature::RoundFunction
            | Feature::Selection
            | Feature::Selectors2
            | Feature::Selectors3
            | Feature::Shadowdomv1
            | Feature::SidamaListStyleType
            | Feature::SignFunction
            | Feature::SimpChineseFormalListStyleType
            | Feature::SimpChineseInformalListStyleType
            | Feature::SomaliListStyleType
            | Feature::SquareListStyleType
            | Feature::StretchSize
            | Feature::StringListStyleType
            | Feature::SymbolsListStyleType
            | Feature::TamilListStyleType
            | Feature::TeluguListStyleType
            | Feature::TextDecorationThicknessShorthand
            | Feature::ThaiListStyleType
            | Feature::TibetanListStyleType
            | Feature::TigreListStyleType
            | Feature::TigrinyaErAbegedeListStyleType
            | Feature::TigrinyaErListStyleType
            | Feature::TigrinyaEtAbegedeListStyleType
            | Feature::TigrinyaEtListStyleType
            | Feature::TradChineseFormalListStyleType
            | Feature::TradChineseInformalListStyleType
            | Feature::UpperAlphaListStyleType
            | Feature::UpperArmenianListStyleType
            | Feature::UpperHexadecimalListStyleType
            | Feature::UpperLatinListStyleType
            | Feature::UpperNorwegianListStyleType
            | Feature::UpperRomanListStyleType
            | Feature::VbUnit
            | Feature::VhUnit
            | Feature::ViewportPercentageUnitsDynamic
            | Feature::ViewportPercentageUnitsLarge
            | Feature::ViewportPercentageUnitsSmall
            | Feature::ViUnit
            | Feature::VmaxUnit
            | Feature::VminUnit
            | Feature::VwUnit
            | Feature::WebkitFillAvailableSize
            | Feature::XResolutionUnit => {
                debug_assert!(
                    false,
                    "compat::Feature::{compat_feature:?} has no Features mapping"
                );
                None
            }
        }
    }
}
