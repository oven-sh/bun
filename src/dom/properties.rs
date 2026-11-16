//! The properties, and the computed style that has a value for each.

use core::cell::OnceCell;
use std::rc::Rc;

use crate::abi::FontMetrics;
use crate::custom::Customs;
use crate::grammar::{Definition, Mode, definition, split_list};
use crate::name::{Map, Name};
use crate::selector::Pseudo;
use crate::shorthand::{self, Part};
use crate::svg_values::*;
use crate::types::*;
use crate::values::*;

/// The computed values that are kept as text: of the properties that have no type, and of those whose type leaves something out.
#[derive(Clone, Default, PartialEq)]
pub(crate) struct Texts(Option<Rc<[(Id, Str)]>>);

impl Texts {
    fn all(&self) -> &[(Id, Str)] {
        self.0.as_deref().unwrap_or_default()
    }

    fn get(&self, id: Id) -> Option<&Str> {
        self.all().iter().find(|it| it.0 == id).map(|it| &it.1)
    }

    fn with(&self, id: Id, text: Option<&Str>) -> Texts {
        let mut all: Vec<_> = self
            .all()
            .iter()
            .filter(|it| it.0 != id)
            .cloned()
            .chain(text.map(|it| (id, Rc::clone(it))))
            .collect();
        all.sort_by_key(|it| it.0 as u16);
        Texts((!all.is_empty()).then(|| all.into()))
    }

    fn differences(&self, other: &Texts, report: &mut impl FnMut(Id)) {
        self.all()
            .iter()
            .filter(|it| other.get(it.0) != Some(&it.1))
            .for_each(|it| report(it.0));
        other
            .all()
            .iter()
            .filter(|it| self.get(it.0).is_none())
            .for_each(|it| report(it.0));
    }
}

macro_rules! longhands {
    ($($group:ident: $Group:ident, inherited = $inherited:literal $(, $texts:ident)? {
        $($Id:ident $name:literal $field:ident: $Type:ty = $initial:expr $(, $spelled:ident)?;)+
    })+
    @ others in svg { $($Inherited:ident $inherited_name:literal)* }
    others in mask { $($Reset:ident $reset_name:literal)* }) => {
        $(
            #[derive(Clone, PartialEq)]
            pub(crate) struct $Group { $(pub(crate) $field: $Type,)+ $($texts: Texts,)? }
            impl Default for $Group {
                fn default() -> Self {
                    $Group { $($field: $initial,)+ $($texts: Texts::default(),)? }
                }
            }
        )+

        #[derive(Clone, Default)]
        pub(crate) struct Groups { $(pub(crate) $group: Rc<$Group>,)+ }

        #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
        #[repr(u16)]
        pub(crate) enum Id { $($($Id,)+)+ $($Inherited,)* $($Reset,)* }

        #[derive(Clone, PartialEq)]
        pub(crate) enum Value {
            $($($Id($Type),)+)+
            Other(Id, Str),
            Spelled(Rc<(Value, Str)>),
        }

        impl Id {
            pub(crate) const ALL: &[Id] = &[$($(Id::$Id,)+)+ $(Id::$Inherited,)* $(Id::$Reset,)*];

            pub(crate) fn name(self) -> &'static str {
                const NAMES: &[&str] = &[$($($name,)+)+ $($inherited_name,)* $($reset_name,)*];
                NAMES[self as usize]
            }

            pub(crate) fn is_inherited(self) -> bool {
                const INHERITED: &[bool] =
                    &[$($({ let _ = $name; $inherited },)+)+ $({ let _ = $inherited_name; true },)* $({ let _ = $reset_name; false },)*];
                INHERITED[self as usize]
            }

            fn is_spelled(self) -> bool {
                match self {
                    $($($(Id::$Id => { let $spelled = true; $spelled })?)+)+
                    _ => false,
                }
            }

            fn has_type(self) -> bool {
                (self as usize) < [$($($name,)+)+].len()
            }

            fn parse_typed(self, p: &mut P, cx: &Ctx) -> Option<Value> {
                match self {
                    $($(Id::$Id => <$Type as Css>::parse(p, cx).map(Value::$Id),)+)+
                    _ => None,
                }
            }
        }

        impl Value {
            pub(crate) fn id(&self) -> Id {
                match self {
                    $($(Value::$Id(_) => Id::$Id,)+)+
                    Value::Other(id, _) => *id,
                    Value::Spelled(it) => it.0.id(),
                }
            }

            pub(crate) fn write(&self, out: &mut Out) {
                match self {
                    $($(Value::$Id(value) => value.write(out),)+)+
                    Value::Other(id, text) => id.write_text(text, out),
                    Value::Spelled(it) => it.0.id().write_text(&it.1, out),
                }
            }

            fn lerp_typed(&self, to: &Value, t: Mixing) -> Option<Value> {
                match (self, to) {
                    $($((Value::$Id(from), Value::$Id(to)) => from.lerp(to, t).map(Value::$Id),)+)+
                    _ => None,
                }
            }
        }

        impl Groups {
            pub(crate) fn get(&self, id: Id) -> Value {
                let value = match id {
                    $($(Id::$Id => Value::$Id(self.$group.$field.clone()),)+)+
                    _ => return Value::Other(id, self.texts(id).get(id).map_or_else(|| id.initial_text().into(), Rc::clone)),
                };
                match self.texts(id).get(id) {
                    Some(text) => Value::Spelled(Rc::new((value, Rc::clone(text)))),
                    None => value,
                }
            }

            pub(crate) fn set(&mut self, value: &Value) {
                match value {
                    $($(Value::$Id(value) => {
                        if self.$group.$field != *value {
                            Rc::make_mut(&mut self.$group).$field = value.clone();
                        }
                        $(let $spelled = Id::$Id;
                        self.set_text($spelled, None);)?
                    })+)+
                    Value::Other(id, text) => self.set_text(*id, Some(text).filter(|it| ***it != *id.initial_text())),
                    Value::Spelled(it) => {
                        self.set(&it.0);
                        self.set_text(it.0.id(), Some(&it.1));
                    }
                }
            }

            pub(crate) fn inheriting(parent: &Groups, initial: &Groups) -> Groups {
                Groups { $($group: Rc::clone(&(if $inherited { parent } else { initial }).$group),)+ }
            }

            /// Shares the groups that are equal to those of `other`.
            pub(crate) fn share_with(&mut self, other: &Groups) {
                $(if !Rc::ptr_eq(&self.$group, &other.$group) && self.$group == other.$group {
                    self.$group = Rc::clone(&other.$group);
                })+
            }

            /// The properties whose values differ.
            pub(crate) fn differences(&self, other: &Groups, mut report: impl FnMut(Id)) {
                $(if !Rc::ptr_eq(&self.$group, &other.$group) {
                    $(if self.$group.$field != other.$group.$field {
                        report(Id::$Id);
                    })+
                    $(self.$group.$texts.differences(&other.$group.$texts, &mut report);)?
                })+
            }
        }
    };
}

/// Which properties apply to a pseudo-element.
#[derive(Clone, Copy, Default, PartialEq, Eq, Hash)]
pub(crate) enum Only {
    #[default]
    All,
    Marker,
    FirstLine,
    FirstLetter,
}

impl Only {
    pub(crate) fn of(pseudo: Pseudo) -> Only {
        match pseudo {
            Pseudo::Marker => Only::Marker,
            Pseudo::FirstLine => Only::FirstLine,
            Pseudo::FirstLetter => Only::FirstLetter,
            _ => Only::All,
        }
    }

    pub(crate) fn allows(self, id: Id) -> bool {
        let is_in = |all: &str| {
            all.split_ascii_whitespace().any(|it| {
                if it.ends_with('-') {
                    id.name().starts_with(it)
                } else {
                    id.name() == it
                }
            })
        };
        let of_text = || {
            is_in(
                "animation- color font- letter-spacing line-height text-autospace text-shadow text-transform word-spacing",
            )
        };
        let of_fragments = || {
            is_in(
                "background- box-shadow opacity text-decoration- text-justify text-underline- vertical-align visibility -webkit-font-smoothing",
            )
        };
        match self {
            Only::All => true,
            Only::Marker => {
                of_text()
                    || is_in(
                        "content cursor direction hyphens line-break overflow-wrap tab-size text-combine-upright text-decoration-skip-ink \
                text-emphasis- text-orientation text-wrap- timeline-trigger- transition- unicode-bidi white-space-collapse word-break",
                    )
            }
            Only::FirstLine => of_text() || of_fragments() || id == Id::RubyPosition,
            Only::FirstLetter => {
                of_text()
                    || of_fragments()
                    || is_in("border- corner- float initial-letter margin- padding-")
            }
        }
    }
}

impl Groups {
    fn texts(&self, id: Id) -> &Texts {
        if id.is_inherited() {
            &self.svg.texts
        } else {
            &self.mask.texts
        }
    }

    fn set_text(&mut self, id: Id, text: Option<&Str>) {
        if self.texts(id).get(id) != text {
            let texts = self.texts(id).with(id, text);
            match id.is_inherited() {
                true => Rc::make_mut(&mut self.svg).texts = texts,
                false => Rc::make_mut(&mut self.mask).texts = texts,
            }
        }
    }

    /// Of a property that has no type, unless it is initial.
    pub(crate) fn other_if_set(&self, id: Id) -> Option<&str> {
        self.texts(id).get(id).map(|it| &**it)
    }

    /// The computed value of a property that has no type. Lengths are not zoomed.
    pub(crate) fn other(&self, id: Id) -> &str {
        self.other_if_set(id).unwrap_or_else(|| id.initial_text())
    }
}

impl Value {
    pub(crate) fn typed(&self) -> &Value {
        if let Value::Spelled(it) = self {
            &it.0
        } else {
            self
        }
    }

    /// With lengths that are `by` times as long.
    pub(crate) fn zoomed(self, by: f32) -> Value {
        if by == 1.0 || !self.id().has_type() {
            return self;
        }
        let mut written = Out::new();
        self.typed().write(&mut written);
        let zoomed = bun_core::strings::contains(&written, b"px").then(|| {
            parse_all(&written, |p| {
                self.id().parse_typed(
                    p,
                    &Ctx {
                        zoom: by,
                        ..Ctx::dummy()
                    },
                )
            })
        });
        match (zoomed.flatten(), self) {
            (Some(value), Value::Spelled(it)) => Value::Spelled(Rc::new((value, Rc::clone(&it.1)))),
            (value, this) => value.unwrap_or(this),
        }
    }

    pub(crate) fn lerp(&self, to: &Value, t: Mixing) -> Option<Value> {
        let (id, syntax) = (self.id(), self.id().syntax());
        if syntax.has_note("mix") {
            let [from, to] = [self, to].map(|it| {
                let mut out = Out::new();
                it.write(&mut out);
                out
            });
            return id.parse(&crate::hooks::mixed(id, &from, &to, t)?, &Ctx::dummy());
        }
        let repeats = syntax.has_note("#");
        if !repeats && !syntax.has_note("~") {
            return self.typed().lerp_typed(to.typed(), t);
        }
        if let Some(value) = self.lerp_typed(to, t) {
            return Some(value);
        }
        let [from, to] = [self, to].map(|it| {
            let mut out = Out::new();
            it.write(&mut out);
            out
        });
        let blended = match repeats {
            false => syntax.lerp(&from, &to, t)?,
            true => {
                let (from, to) = (split_list(&from), split_list(&to));
                let count = (1..=to.len())
                    .map(|it| it * from.len())
                    .find(|it| it % to.len() == 0)
                    .filter(|it| *it < 1000)?;
                let items =
                    (0..count).map(|it| syntax.lerp(from[it % from.len()], to[it % to.len()], t));
                items.collect::<Option<Vec<_>>>()?.join(&b", "[..])
            }
        };
        id.parse(&blended, &Ctx::dummy())
    }
}

flags!(WillChange, "auto" { TRANSFORM = 0 "transform", OPACITY = 1 "opacity", FILTER = 2 "filter", OTHER = 3 "contents",
    STACKS = 4 "isolation", CONTAINS = 5 "contain", POSITION = 6 "position", Z_INDEX = 7 "z-index" });

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct WillChangeList(pub(crate) WillChange);

impl Css for WillChangeList {
    fn parse(p: &mut P, _: &Ctx) -> Option<Self> {
        let flag = |name: &[u8]| match text(name)
            .to_ascii_lowercase()
            .trim_start_matches("-webkit-")
        {
            "auto" => WillChange::empty(),
            "transform" | "translate" | "rotate" | "scale" | "perspective" => WillChange::TRANSFORM,
            "opacity" | "mask" | "mask-image" | "mask-border" | "clip-path" | "mix-blend-mode" => {
                WillChange::OPACITY
            }
            "filter" | "backdrop-filter" => WillChange::FILTER,
            "isolation" | "view-transition-name" => WillChange::STACKS,
            "contain" | "transform-style" | "offset-path" | "offset-position" | "offset" => {
                WillChange::CONTAINS
            }
            "position" => WillChange::POSITION,
            "z-index" => WillChange::Z_INDEX,
            _ => WillChange::OTHER,
        };
        Some(WillChangeList(
            commas(p, ident)?.into_iter().map(flag).collect(),
        ))
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
    }
}

#[derive(Clone, PartialEq)]
pub(crate) enum TransitionProperty {
    All,
    Known(Prop),
    Other(Str),
}

impl Css for TransitionProperty {
    fn parse(p: &mut P, _: &Ctx) -> Option<Self> {
        let name = ident(p)?;
        Some(match Prop::from_name(name) {
            _ if eq(name, "all") => TransitionProperty::All,
            Some(Prop::Custom(_)) | None => TransitionProperty::Other(text(name).into()),
            Some(prop) => TransitionProperty::Known(prop),
        })
    }
    fn write(&self, out: &mut Out) {
        out.extend_from_slice(match self {
            TransitionProperty::All => b"all",
            TransitionProperty::Known(prop) => prop.name().as_bytes(),
            TransitionProperty::Other(name) => name.as_bytes(),
        });
    }
}

fn raw(value: &str) -> Raw {
    Raw(value.into())
}

type Margin = Auto<Lp>;
const NO_MARGIN: Margin = Auto(Some(Lp::ZERO));
const NO_PADDING: PositiveLp = PositiveLp(Lp::ZERO);
const SQUARE: Corner = Pair(NO_PADDING, NO_PADDING);

longhands! {
    font: Font, inherited = true {
        FontFamily "font-family" family: Families = Families(b"\x01serif\0"[..].into());
        FontSize "font-size" size: FontSize = FontSize(16.0);
        FontWeight "font-weight" weight: FontWeight = FontWeight(400.0);
        FontStyle "font-style" style: FontStyle = FontStyle::Normal;
        FontStretch "font-stretch" stretch: FontStretch = FontStretch(100.0);
        FontVariationSettings "font-variation-settings" variations: FontSettings = Default::default();
        FontFeatureSettings "font-feature-settings" features: FontSettings = Default::default();
        FontVariantLigatures "font-variant-ligatures" ligatures: Ligatures = Ligatures::empty();
        FontVariantNumeric "font-variant-numeric" numeric: Numeric = Numeric::empty();
        FontVariantCaps "font-variant-caps" caps: FontCaps = FontCaps::Normal;
        FontKerning "font-kerning" kerning: FontKerning = FontKerning::Auto;
        FontOpticalSizing "font-optical-sizing" optical_sizing: AutoOrNone = AutoOrNone::Auto;
        FontSynthesisWeight "font-synthesis-weight" synthesis_weight: AutoOrNone = AutoOrNone::Auto;
        FontSynthesisStyle "font-synthesis-style" synthesis_style: AutoOrNone = AutoOrNone::Auto;
        Locale "-webkit-locale" locale: Raw = raw("auto"), spelled;
        LineHeight "line-height" line_height: LineHeight = LineHeight::Normal;
    }
    text: Text, inherited = true {
        Direction "direction" direction: Direction = Direction::Ltr;
        WritingMode "writing-mode" writing_mode: WritingMode = WritingMode::HorizontalTb;
        TextOrientation "text-orientation" orientation: TextOrientation = TextOrientation::Mixed;
        TextCombineUpright "text-combine-upright" combine: TextCombine = TextCombine::None;
        TextAlign "text-align" align: TextAlign = TextAlign::Start;
        TextAlignLast "text-align-last" align_last: TextAlignLast = TextAlignLast::Auto;
        TextIndent "text-indent" indent: TextIndent = TextIndent { length: Lp::ZERO, hangs: false, each_line: false };
        TextJustify "text-justify" justify: TextJustify = TextJustify::Auto;
        TextAutospace "text-autospace" autospace: TextAutospace = TextAutospace::NoAutospace;
        TextSpacingTrim "text-spacing-trim" spacing_trim: TextSpacingTrim = TextSpacingTrim::Normal;
        TextBoxEdge "text-box-edge" box_edge: TextBoxEdge = TextBoxEdge(OverEdge::Auto, false);
        HyphenateCharacter "hyphenate-character" hyphen: Auto<Quoted> = Auto(None);
        RubyAlign "ruby-align" ruby_align: RubyAlign = RubyAlign::SpaceAround;
        RubyPosition "ruby-position" ruby_position: RubyPosition = RubyPosition::Over;
        RubyOverhang "ruby-overhang" ruby_overhang: RubyOverhang = RubyOverhang::Auto;
        TextTransform "text-transform" transform: TextTransform = TextTransform::None;
        LetterSpacing "letter-spacing" letter_spacing: Spacing = Spacing(Lp::ZERO);
        WordSpacing "word-spacing" word_spacing: Spacing = Spacing(Lp::ZERO);
        WhiteSpaceCollapse "white-space-collapse" collapse: WhiteSpaceCollapse = WhiteSpaceCollapse::Collapse;
        TextWrapMode "text-wrap-mode" wrap: TextWrapMode = TextWrapMode::Wrap;
        TextWrapStyle "text-wrap-style" wrap_style: TextWrapStyle = TextWrapStyle::Auto;
        WordBreak "word-break" word_break: WordBreak = WordBreak::Normal;
        OverflowWrap "overflow-wrap" overflow_wrap: OverflowWrap = OverflowWrap::Normal;
        LineBreak "line-break" line_break: LineBreak = LineBreak::Auto;
        Hyphens "hyphens" hyphens: Hyphens = Hyphens::Manual;
        Orphans "orphans" orphans: Count = Count(2);
        Widows "widows" widows: Count = Count(2);
        TabSize "tab-size" tab_size: TabSize = TabSize::Spaces(8.0);
        TextSecurity "-webkit-text-security" security: TextSecurity = TextSecurity::None;
        ListStyleType "list-style-type" list_type: ListStyleType = ListStyleType::Named("disc".into()), spelled;
        ListStylePosition "list-style-position" list_position: ListStylePosition = ListStylePosition::Outside;
        ListStyleImage "list-style-image" list_image: NoneOr<Image> = NoneOr(None), spelled;
        Quotes "quotes" quotes: Quotes = Quotes(None), spelled;
        BorderCollapse "border-collapse" border_collapse: BorderCollapse = BorderCollapse::Separate;
        BorderHorizontalSpacing "-webkit-border-horizontal-spacing" spacing_x: PositivePx = PositivePx(0.0);
        BorderVerticalSpacing "-webkit-border-vertical-spacing" spacing_y: PositivePx = PositivePx(0.0);
        CaptionSide "caption-side" caption_side: CaptionSide = CaptionSide::Top;
        UserModify "-webkit-user-modify" user_modify: UserModify = UserModify::ReadOnly;
    }
    ink: Ink, inherited = true {
        Color "color" color: Rgba = Rgba::BLACK;
        ColorScheme "color-scheme" color_scheme: ColorScheme = ColorScheme::empty(), spelled;
        Visibility "visibility" visibility: Visible = Visible(Visibility::Visible);
        Cursor "cursor" cursor: Cursor = Cursor(CursorName::Auto), spelled;
        PointerEvents "pointer-events" pointer_events: PointerEvents = PointerEvents::Auto;
        UserSelect "user-select" user_select: UserSelect = UserSelect::Auto;
        Interactivity "interactivity" interactivity: Interactivity = Interactivity::Auto;
        AppRegion "app-region" app_region: AppRegion = AppRegion::None;
        TextShadow "text-shadow" text_shadow: TextShadows = TextShadows::default();
        TextUnderlineOffset "text-underline-offset" underline_offset: Auto<Lp> = Auto(None);
        TextUnderlinePosition "text-underline-position" underline_position: UnderlinePosition = UnderlinePosition::empty();
        CaretColor "caret-color" caret_color: Auto<Color> = Auto(None);
        AccentColor "accent-color" accent_color: Auto<Color> = Auto(None);
        TextFillColor "-webkit-text-fill-color" text_fill_color: Color = Color::Current;
        ImageRendering "image-rendering" image_rendering: ImageRendering = ImageRendering::Auto, spelled;
        TextDecorationSkipInk "text-decoration-skip-ink" skip_ink: SkipInk = SkipInk::Auto;
        InterpolateSize "interpolate-size" interpolate_size: InterpolateSize = InterpolateSize::NumericOnly;
        ScrollbarColor "scrollbar-color" scrollbar_color: Auto<Pair<Color>> = Auto(None);
    }
    svg: Svg, inherited = true, texts {
        Fill "fill" fill: SvgPaint = SvgPaint::Color(Color::Rgba(0xff)), spelled;
        FillOpacity "fill-opacity" fill_opacity: Alpha = Alpha::new(1.0);
        FillRule "fill-rule" fill_rule: FillRule = FillRule::Nonzero;
        ClipRule "clip-rule" clip_rule: FillRule = FillRule::Nonzero;
        Stroke "stroke" stroke: SvgPaint = SvgPaint::None, spelled;
        StrokeOpacity "stroke-opacity" stroke_opacity: Alpha = Alpha::new(1.0);
        StrokeWidth "stroke-width" stroke_width: StrokeWidth = StrokeWidth(Lp::Px(1.0));
        StrokeDasharray "stroke-dasharray" dasharray: Dashes = Dashes::default();
        StrokeDashoffset "stroke-dashoffset" dashoffset: SvgLength = SvgLength(Lp::ZERO);
        StrokeLinecap "stroke-linecap" linecap: LineCap = LineCap::Butt;
        StrokeLinejoin "stroke-linejoin" linejoin: LineJoin = LineJoin::Miter;
        StrokeMiterlimit "stroke-miterlimit" miterlimit: Positive = Positive(4.0);
        PaintOrder "paint-order" paint_order: PaintOrder = PaintOrder::NORMAL, spelled;
        TextAnchor "text-anchor" text_anchor: TextAnchor = TextAnchor::Start;
        DominantBaseline "dominant-baseline" dominant_baseline: DominantBaseline = DominantBaseline::Auto;
        ShapeRendering "shape-rendering" shape_rendering: ShapeRendering = ShapeRendering::Auto;
        TextRendering "text-rendering" text_rendering: TextRendering = TextRendering::Auto;
        ColorRendering "color-rendering" color_rendering: ColorRendering = ColorRendering::Auto;
        ColorInterpolation "color-interpolation" color_interpolation: ColorInterpolation = ColorInterpolation::Srgb;
        ColorInterpolationFilters "color-interpolation-filters" filter_interpolation: ColorInterpolation = ColorInterpolation::LinearRgb;
        MarkerStart "marker-start" marker_start: NoneOr<Url> = NoneOr(None);
        MarkerMid "marker-mid" marker_mid: NoneOr<Url> = NoneOr(None);
        MarkerEnd "marker-end" marker_end: NoneOr<Url> = NoneOr(None);
    }
    shape: SvgShape, inherited = false {
        X "x" x: Lp = Lp::ZERO;
        Y "y" y: Lp = Lp::ZERO;
        Cx "cx" cx: Lp = Lp::ZERO;
        Cy "cy" cy: Lp = Lp::ZERO;
        R "r" r: PositiveLp = NO_PADDING;
        Rx "rx" rx: Auto<PositiveLp> = Auto(None);
        Ry "ry" ry: Auto<PositiveLp> = Auto(None);
        D "d" d: PathData = PathData::Attribute;
        StopColor "stop-color" stop_color: Color = Color::Rgba(0xff);
        StopOpacity "stop-opacity" stop_opacity: Alpha = Alpha::new(1.0);
        FloodColor "flood-color" flood_color: Color = Color::Rgba(0xff);
        FloodOpacity "flood-opacity" flood_opacity: Alpha = Alpha::new(1.0);
        LightingColor "lighting-color" lighting_color: Color = Color::Rgba(0xffff_ffff);
        VectorEffect "vector-effect" vector_effect: VectorEffect = VectorEffect::None;
        MaskType "mask-type" mask_type: MaskType = MaskType::Luminance;
        AlignmentBaseline "alignment-baseline" alignment_baseline: AlignmentBaseline = AlignmentBaseline::Auto;
        BaselineShift "baseline-shift" baseline_shift: BaselineShift = BaselineShift::Length(Lp::ZERO);
        BufferedRendering "buffered-rendering" buffered_rendering: BufferedRendering = BufferedRendering::Auto;
    }
    layout: Layout, inherited = false {
        Display "display" display: DisplayValue = DisplayValue(Display::Inline);
        Position "position" position: PositionKind = PositionKind::Static;
        Float "float" float: Float = Float::None;
        Clear "clear" clear: Clear = Clear::None;
        BoxSizing "box-sizing" box_sizing: BoxSizing = BoxSizing::ContentBox;
        Width "width" width: Size = Size::Auto;
        Height "height" height: Size = Size::Auto;
        MinWidth "min-width" min_width: Size = Size::Auto;
        MinHeight "min-height" min_height: Size = Size::Auto;
        MaxWidth "max-width" max_width: MaxSize = MaxSize(Size::Auto);
        MaxHeight "max-height" max_height: MaxSize = MaxSize(Size::Auto);
        MarginTop "margin-top" margin_top: Margin = NO_MARGIN;
        MarginRight "margin-right" margin_right: Margin = NO_MARGIN;
        MarginBottom "margin-bottom" margin_bottom: Margin = NO_MARGIN;
        MarginLeft "margin-left" margin_left: Margin = NO_MARGIN;
        PaddingTop "padding-top" padding_top: PositiveLp = NO_PADDING;
        PaddingRight "padding-right" padding_right: PositiveLp = NO_PADDING;
        PaddingBottom "padding-bottom" padding_bottom: PositiveLp = NO_PADDING;
        PaddingLeft "padding-left" padding_left: PositiveLp = NO_PADDING;
        Top "top" top: Inset = Inset::Auto;
        Right "right" right: Inset = Inset::Auto;
        Bottom "bottom" bottom: Inset = Inset::Auto;
        Left "left" left: Inset = Inset::Auto;
        BorderTopWidth "border-top-width" border_top: BorderWidth = BorderWidth(3.0);
        BorderRightWidth "border-right-width" border_right: BorderWidth = BorderWidth(3.0);
        BorderBottomWidth "border-bottom-width" border_bottom: BorderWidth = BorderWidth(3.0);
        BorderLeftWidth "border-left-width" border_left: BorderWidth = BorderWidth(3.0);
        BorderTopStyle "border-top-style" border_top_style: BorderStyle = BorderStyle::None;
        BorderRightStyle "border-right-style" border_right_style: BorderStyle = BorderStyle::None;
        BorderBottomStyle "border-bottom-style" border_bottom_style: BorderStyle = BorderStyle::None;
        BorderLeftStyle "border-left-style" border_left_style: BorderStyle = BorderStyle::None;
        OverflowX "overflow-x" overflow_x: Overflow = Overflow::Visible;
        OverflowY "overflow-y" overflow_y: Overflow = Overflow::Visible;
        FlexDirection "flex-direction" flex_direction: FlexDirection = FlexDirection::Row;
        FlexWrap "flex-wrap" flex_wrap: FlexWrap = FlexWrap::default();
        FlexGrow "flex-grow" flex_grow: Positive = Positive(0.0);
        FlexShrink "flex-shrink" flex_shrink: Positive = Positive(1.0);
        FlexBasis "flex-basis" flex_basis: FlexBasis = FlexBasis(Size::Auto);
        Order "order" order: i32 = 0;
        AlignContent "align-content" align_content: Align = Align::NORMAL;
        AlignItems "align-items" align_items: Align = Align::NORMAL;
        AlignSelf "align-self" align_self: Align = Align::AUTO;
        JustifyContent "justify-content" justify_content: Align = Align::NORMAL;
        JustifyItems "justify-items" justify_items: Align = Align::NORMAL;
        JustifySelf "justify-self" justify_self: Align = Align::AUTO;
        RowGap "row-gap" row_gap: Normal<PositiveLp> = Normal(None);
        ColumnGap "column-gap" column_gap: Normal<PositiveLp> = Normal(None);
        AspectRatio "aspect-ratio" aspect_ratio: AspectRatio = AspectRatio { auto: true, ratio: None };
        VerticalAlign "vertical-align" vertical_align: VerticalAlign = VerticalAlign::Keyword(VerticalAlignName::Baseline), spelled;
        UnicodeBidi "unicode-bidi" unicode_bidi: UnicodeBidi = UnicodeBidi::Normal;
        TextOverflow "text-overflow" text_overflow: TextOverflow = TextOverflow::Clip;
        ScrollbarWidth "scrollbar-width" scrollbar_width: ScrollbarWidth = ScrollbarWidth::Auto;
        ScrollbarGutter "scrollbar-gutter" scrollbar_gutter: ScrollbarGutter = ScrollbarGutter::empty();
        Contain "contain" contain: Contain = Contain::empty();
        ContentVisibility "content-visibility" content_visibility: ContentVisibility = ContentVisibility::Visible;
        ContainerType "container-type" container_type: ContainerType = ContainerType::empty();
        Appearance "appearance" appearance: Appearance = Appearance::None, spelled;
    }
    rare: Rare, inherited = false {
        LineClamp "-webkit-line-clamp" line_clamp: NoneOr<Count> = NoneOr(None);
        BoxOrient "-webkit-box-orient" box_orient: BoxOrient = BoxOrient::Horizontal, spelled;
        BoxAlign "-webkit-box-align" box_align: Align = Align::NORMAL, spelled;
        BoxFlex "-webkit-box-flex" box_flex: f32 = 0.0;
        TableLayout "table-layout" table_layout: TableLayout = TableLayout::Auto;
        ContainerName "container-name" container_name: NoneOrSpaces<Str> = Default::default();
        ContainIntrinsicWidth "contain-intrinsic-width" intrinsic_width: IntrinsicSize = IntrinsicSize { remembers: false, length: None };
        ContainIntrinsicHeight "contain-intrinsic-height" intrinsic_height: IntrinsicSize = IntrinsicSize { remembers: false, length: None };
        FieldSizing "field-sizing" field_sizing: FieldSizing = FieldSizing::Fixed;
        ColumnCount "column-count" column_count: Auto<Count> = Auto(None);
        ColumnWidth "column-width" column_width: Auto<PositivePx> = Auto(None);
        ColumnHeight "column-height" column_height: Auto<PositivePx> = Auto(None);
        ColumnWrap "column-wrap" column_wrap: ColumnWrap = ColumnWrap::Auto;
        ColumnFill "column-fill" column_fill: ColumnFill = ColumnFill::Balance;
        ColumnSpan "column-span" column_span: ColumnSpan = ColumnSpan::None;
        ColumnRuleWidth "column-rule-width" rule_width: BorderWidth = BorderWidth(3.0), spelled;
        ColumnRuleStyle "column-rule-style" rule_style: BorderStyle = BorderStyle::None, spelled;
        ColumnRuleColor "column-rule-color" rule_color: Color = Color::Current, spelled;
        BreakBefore "break-before" break_before: BreakBetween = BreakBetween::Auto;
        BreakAfter "break-after" break_after: BreakBetween = BreakBetween::Auto;
        BreakInside "break-inside" break_inside: BreakInside = BreakInside::Auto;
        FlexLineCount "flex-line-count" flex_line_count: Count = Count(1);
        Content "content" content: Content = Content::Normal, spelled;
        CounterReset "counter-reset" counter_reset: NoneOrSpaces<Counter> = Default::default(), spelled;
        CounterIncrement "counter-increment" counter_increment: NoneOrSpaces<Counter> = Default::default(), spelled;
        CounterSet "counter-set" counter_set: NoneOrSpaces<Counter> = Default::default(), spelled;
        Zoom "zoom" zoom: Zoom = Zoom(1.0);
        BoxDecorationBreak "box-decoration-break" decoration_break: DecorationBreak = DecorationBreak::Slice;
        AnchorName "anchor-name" anchor_name: NoneOrCommas<Str> = Default::default();
        PositionAnchor "position-anchor" position_anchor: Raw = raw("normal");
        PositionArea "position-area" position_area: NoneOrSpaces<Str> = Default::default(), spelled;
        PositionTryFallbacks "position-try-fallbacks" position_try: Raw = raw("none"), spelled;
        ShapeOutside "shape-outside" shape_outside: ShapeOutside = ShapeOutside(ClipPath(None)), spelled;
        MarginTrim "margin-trim" margin_trim: MarginTrim = MarginTrim([false; 2]);
        ShapeMargin "shape-margin" shape_margin: PositiveLp = NO_PADDING;
        ShapeImageThreshold "shape-image-threshold" shape_threshold: Alpha = Alpha::new(0.0);
        TextBoxTrim "text-box-trim" box_trim: TextBoxTrim = TextBoxTrim::None;
        BaselineSource "baseline-source" baseline_source: BaselineSource = BaselineSource::Auto;
        InitialLetter "initial-letter" initial_letter: Normal<InitialLetter> = Normal(None);
        Overlay "overlay" overlay: OverlayKind = OverlayKind::None;
    }
    grid: Grid, inherited = false {
        GridTemplateRows "grid-template-rows" rows: Template = Template::None, spelled;
        GridTemplateColumns "grid-template-columns" columns: Template = Template::None, spelled;
        GridTemplateAreas "grid-template-areas" areas: Areas = Areas::default();
        GridAutoRows "grid-auto-rows" auto_rows: AutoTracks = AutoTracks(Rc::new([Track::Breadth(Breadth::Auto)])), spelled;
        GridAutoColumns "grid-auto-columns" auto_columns: AutoTracks = AutoTracks(Rc::new([Track::Breadth(Breadth::Auto)])), spelled;
        GridAutoFlow "grid-auto-flow" flow: GridAutoFlow = GridAutoFlow::default();
        GridRowStart "grid-row-start" row_start: GridLine = GridLine::Auto, spelled;
        GridColumnStart "grid-column-start" column_start: GridLine = GridLine::Auto, spelled;
        GridRowEnd "grid-row-end" row_end: GridLine = GridLine::Auto, spelled;
        GridColumnEnd "grid-column-end" column_end: GridLine = GridLine::Auto, spelled;
    }
    paint: Paint, inherited = false {
        BackgroundColor "background-color" background_color: Color = Color::TRANSPARENT;
        BorderTopColor "border-top-color" border_top: Color = Color::Current;
        BorderRightColor "border-right-color" border_right: Color = Color::Current;
        BorderBottomColor "border-bottom-color" border_bottom: Color = Color::Current;
        BorderLeftColor "border-left-color" border_left: Color = Color::Current;
        BorderTopLeftRadius "border-top-left-radius" top_left: Corner = SQUARE;
        BorderTopRightRadius "border-top-right-radius" top_right: Corner = SQUARE;
        BorderBottomRightRadius "border-bottom-right-radius" bottom_right: Corner = SQUARE;
        BorderBottomLeftRadius "border-bottom-left-radius" bottom_left: Corner = SQUARE;
        BoxShadow "box-shadow" box_shadow: Shadows = Shadows::default();
        OutlineWidth "outline-width" outline_width: BorderWidth = BorderWidth(3.0);
        OutlineStyle "outline-style" outline_style: OutlineStyle = OutlineStyle::None;
        OutlineColor "outline-color" outline_color: Color = Color::Current;
        OutlineOffset "outline-offset" outline_offset: Px = Px(0.0);
        TextDecorationLine "text-decoration-line" decoration_line: DecorationLine = DecorationLine::empty(), spelled;
        TextDecorationStyle "text-decoration-style" decoration_style: DecorationStyle = DecorationStyle::Solid;
        TextDecorationColor "text-decoration-color" decoration_color: Color = Color::Current;
        TextDecorationThickness "text-decoration-thickness" decoration_thickness: Thickness = Thickness(None, false);
        ZIndex "z-index" z_index: Auto<i32> = Auto(None);
    }
    background: Background, inherited = false {
        BackgroundImage "background-image" image: Commas<NoneOr<Image>> = Commas::one(NoneOr(None)), spelled;
        BackgroundPositionX "background-position-x" x: Commas<AxisPosition> = Commas::one(AxisPosition(Lp::Fraction(0.0)));
        BackgroundPositionY "background-position-y" y: Commas<AxisPosition> = Commas::one(AxisPosition(Lp::Fraction(0.0)));
        BackgroundSize "background-size" size: Commas<BackgroundSize> = Commas::one(BackgroundSize::AUTO);
        BackgroundRepeat "background-repeat" repeat: Commas<Repeat> = Commas::one(Repeat(RepeatKind::Repeat, RepeatKind::Repeat));
        BackgroundOrigin "background-origin" origin: Commas<BoxArea> = Commas::one(BoxArea::PaddingBox);
        BackgroundClip "background-clip" clip: Commas<BoxArea> = Commas::one(BoxArea::BorderBox), spelled;
        BackgroundAttachment "background-attachment" attachment: Commas<Attachment> = Commas::one(Attachment::Scroll);
        BackgroundBlendMode "background-blend-mode" blend: Commas<Blend> = Commas::one(Blend::Normal);
        BorderImageSource "border-image-source" border_image: NoneOr<Image> = NoneOr(None), spelled;
    }
    mask: Mask, inherited = false, texts {
        MaskImage "mask-image" image: Commas<NoneOr<Image>> = Commas::one(NoneOr(None)), spelled;
        MaskPositionX "-webkit-mask-position-x" x: Commas<AxisPosition> = Commas::one(AxisPosition(Lp::Fraction(0.0)));
        MaskPositionY "-webkit-mask-position-y" y: Commas<AxisPosition> = Commas::one(AxisPosition(Lp::Fraction(0.0)));
        MaskSize "mask-size" size: Commas<BackgroundSize> = Commas::one(BackgroundSize::AUTO);
        MaskRepeat "mask-repeat" repeat: Commas<Repeat> = Commas::one(Repeat(RepeatKind::Repeat, RepeatKind::Repeat));
        MaskOrigin "mask-origin" origin: Commas<BoxArea> = Commas::one(BoxArea::BorderBox), spelled;
        MaskClip "mask-clip" clip: Commas<BoxArea> = Commas::one(BoxArea::BorderBox), spelled;
        MaskComposite "mask-composite" composite: Commas<MaskComposite> = Commas::one(MaskComposite::Add);
        MaskMode "mask-mode" mode: Commas<MaskMode> = Commas::one(MaskMode::MatchSource);
    }
    effects: Effects, inherited = false {
        Opacity "opacity" opacity: Alpha = Alpha::new(1.0);
        Transform "transform" transform: Transforms = Transforms::default();
        Translate "translate" translate: Translate = Translate(None);
        Rotate "rotate" rotate: Rotate = Rotate(None);
        Scale "scale" scale: Scale = Scale(None);
        TransformOrigin "transform-origin" origin: TransformOrigin = TransformOrigin(Position::CENTER, 0.0);
        TransformBox "transform-box" transform_box: TransformBox = TransformBox::ViewBox;
        Perspective "perspective" perspective: NoneOr<PositivePx> = NoneOr(None);
        BackfaceVisibility "backface-visibility" backface: Backface = Backface::Visible;
        Filter "filter" filter: Filters = Filters::default();
        BackdropFilter "backdrop-filter" backdrop_filter: Filters = Filters::default();
        MixBlendMode "mix-blend-mode" blend: Blend = Blend::Normal;
        Isolation "isolation" isolation: Isolation = Isolation::Auto;
        ClipPath "clip-path" clip_path: ClipPath = ClipPath(None), spelled;
        Clip "clip" clip: Auto<ClipRect> = Auto(None);
        OverflowClipMargin "overflow-clip-margin" clip_margin: ClipMargin = ClipMargin(BoxArea::PaddingBox, 0.0), spelled;
        WillChange "will-change" will_change: WillChangeList = WillChangeList(WillChange::empty()), spelled;
        ObjectFit "object-fit" object_fit: ObjectFit = ObjectFit::Fill;
        ObjectPosition "object-position" object_position: Position = Position::CENTER;
    }
    transition: Transition, inherited = false {
        TransitionProperty "transition-property" property: NoneOrCommas<TransitionProperty> = NoneOrCommas(Rc::new([TransitionProperty::All])), spelled;
        TransitionDuration "transition-duration" duration: Commas<Duration> = Commas::one(Duration(0.0));
        TransitionTimingFunction "transition-timing-function" easing: Commas<Easing> = Commas::one(Easing::EASE);
        TransitionDelay "transition-delay" delay: Commas<Time> = Commas::one(Time(0.0));
        TransitionBehavior "transition-behavior" behavior: Commas<TransitionBehavior> = Commas::one(TransitionBehavior::Normal);
    }
    animation: Animation, inherited = false {
        AnimationName "animation-name" name: Commas<AnimationName> = Commas::one(AnimationName(None));
        AnimationDuration "animation-duration" duration: Commas<Duration> = Commas::one(Duration(-1.0));
        AnimationTimingFunction "animation-timing-function" easing: Commas<Easing> = Commas::one(Easing::EASE);
        AnimationDelay "animation-delay" delay: Commas<Time> = Commas::one(Time(0.0));
        AnimationIterationCount "animation-iteration-count" iterations: Commas<Iterations> = Commas::one(Iterations(1.0));
        AnimationDirection "animation-direction" direction: Commas<AnimationDirection> = Commas::one(AnimationDirection::Normal);
        AnimationFillMode "animation-fill-mode" fill: Commas<FillMode> = Commas::one(FillMode::None);
        AnimationPlayState "animation-play-state" play_state: Commas<PlayState> = Commas::one(PlayState::Running);
        AnimationTimeline "animation-timeline" timeline: Commas<Timeline> = Commas::one(Timeline::Auto), spelled;
        AnimationRangeStart "animation-range-start" range_start: Commas<RangeEdge> = Commas::one(RangeEdge(None, None)), spelled;
        AnimationRangeEnd "animation-range-end" range_end: Commas<RangeEdge> = Commas::one(RangeEdge(None, None)), spelled;
    }
    scroll: Scroll, inherited = false {
        ScrollBehavior "scroll-behavior" behavior: ScrollBehavior = ScrollBehavior::Auto;
        ScrollMarginTop "scroll-margin-top" margin_top: Px = Px(0.0);
        ScrollMarginRight "scroll-margin-right" margin_right: Px = Px(0.0);
        ScrollMarginBottom "scroll-margin-bottom" margin_bottom: Px = Px(0.0);
        ScrollMarginLeft "scroll-margin-left" margin_left: Px = Px(0.0);
        ScrollPaddingTop "scroll-padding-top" padding_top: Auto<PositiveLp> = Auto(None);
        ScrollPaddingRight "scroll-padding-right" padding_right: Auto<PositiveLp> = Auto(None);
        ScrollPaddingBottom "scroll-padding-bottom" padding_bottom: Auto<PositiveLp> = Auto(None);
        ScrollPaddingLeft "scroll-padding-left" padding_left: Auto<PositiveLp> = Auto(None);
        OverscrollBehaviorX "overscroll-behavior-x" overscroll_x: Overscroll = Overscroll::Auto, spelled;
        OverscrollBehaviorY "overscroll-behavior-y" overscroll_y: Overscroll = Overscroll::Auto, spelled;
        ScrollSnapType "scroll-snap-type" snap_type: ScrollSnapType = ScrollSnapType::empty(), spelled;
        ScrollSnapAlign "scroll-snap-align" snap_align: Pair<SnapAlign> = Pair(SnapAlign::None, SnapAlign::None);
        OverflowAnchor "overflow-anchor" anchor: AutoOrNone = AutoOrNone::Auto, spelled;
        ScrollTimelineName "scroll-timeline-name" timeline_name: NoneOrCommas<Str> = Default::default(), spelled;
        ScrollTimelineAxis "scroll-timeline-axis" timeline_axis: Commas<Axis> = Commas::one(Axis::Block);
        TouchAction "touch-action" touch_action: Raw = raw("auto"), spelled;
        Resize "resize" resize: Resize = Resize::None;
    }
    @ others in svg {
        WebkitBoxDirection "-webkit-box-direction"
        WebkitFontSmoothing "-webkit-font-smoothing"
        WebkitRtlOrdering "-webkit-rtl-ordering"
        WebkitRubyPosition "-webkit-ruby-position"
        WebkitTapHighlightColor "-webkit-tap-highlight-color"
        WebkitTextCombine "-webkit-text-combine"
        WebkitTextDecorationsInEffect "-webkit-text-decorations-in-effect"
        WebkitTextStrokeColor "-webkit-text-stroke-color"
        WebkitTextStrokeWidth "-webkit-text-stroke-width"
        CaretAnimation "caret-animation"
        CaretShape "caret-shape"
        DynamicRangeLimit "dynamic-range-limit"
        EmptyCells "empty-cells"
        FontLanguageOverride "font-language-override"
        FontPalette "font-palette"
        FontSizeAdjust "font-size-adjust"
        FontSynthesisSmallCaps "font-synthesis-small-caps"
        FontVariantAlternates "font-variant-alternates"
        FontVariantEastAsian "font-variant-east-asian"
        FontVariantEmoji "font-variant-emoji"
        FontVariantPosition "font-variant-position"
        ForcedColorAdjust "forced-color-adjust"
        HyphenateLimitChars "hyphenate-limit-chars"
        ImageOrientation "image-orientation"
        MathDepth "math-depth"
        MathShift "math-shift"
        MathStyle "math-style"
        PrintColorAdjust "print-color-adjust"
        Speak "speak"
        TextEmphasisColor "text-emphasis-color"
        TextEmphasisPosition "text-emphasis-position"
        TextEmphasisStyle "text-emphasis-style"
        TextFit "text-fit"
        TextSizeAdjust "text-size-adjust"
        WindowDrag "window-drag"
    }
    others in mask {
        WebkitPerspectiveOriginX "-webkit-perspective-origin-x"
        WebkitPerspectiveOriginY "-webkit-perspective-origin-y"
        WebkitTransformOriginX "-webkit-transform-origin-x"
        WebkitTransformOriginY "-webkit-transform-origin-y"
        WebkitTransformOriginZ "-webkit-transform-origin-z"
        WebkitBorderImage "-webkit-border-image"
        WebkitBoxOrdinalGroup "-webkit-box-ordinal-group"
        WebkitBoxPack "-webkit-box-pack"
        WebkitBoxReflect "-webkit-box-reflect"
        WebkitMaskBoxImageOutset "-webkit-mask-box-image-outset"
        WebkitMaskBoxImageRepeat "-webkit-mask-box-image-repeat"
        WebkitMaskBoxImageSlice "-webkit-mask-box-image-slice"
        WebkitMaskBoxImageSource "-webkit-mask-box-image-source"
        WebkitMaskBoxImageWidth "-webkit-mask-box-image-width"
        WebkitUserDrag "-webkit-user-drag"
        AnchorScope "anchor-scope"
        AnimationComposition "animation-composition"
        AnimationTrigger "animation-trigger"
        BorderImageOutset "border-image-outset"
        BorderImageRepeat "border-image-repeat"
        BorderImageSlice "border-image-slice"
        BorderImageWidth "border-image-width"
        BorderShape "border-shape"
        ColumnRuleBreak "column-rule-break"
        ColumnRuleInsetCapEnd "column-rule-inset-cap-end"
        ColumnRuleInsetCapStart "column-rule-inset-cap-start"
        ColumnRuleInsetJunctionEnd "column-rule-inset-junction-end"
        ColumnRuleInsetJunctionStart "column-rule-inset-junction-start"
        ColumnRuleVisibilityItems "column-rule-visibility-items"
        CornerTopLeftShape "corner-top-left-shape"
        CornerTopRightShape "corner-top-right-shape"
        CornerBottomRightShape "corner-bottom-right-shape"
        CornerBottomLeftShape "corner-bottom-left-shape"
        FrameSizing "frame-sizing"
        InterestDelayEnd "interest-delay-end"
        InterestDelayStart "interest-delay-start"
        ObjectViewBox "object-view-box"
        OffsetAnchor "offset-anchor"
        OffsetDistance "offset-distance"
        OffsetPath "offset-path"
        OffsetPosition "offset-position"
        OffsetRotate "offset-rotate"
        Page "page"
        PageMarginSafety "page-margin-safety"
        PageOrientation "page-orientation"
        PerspectiveOrigin "perspective-origin"
        PositionTryOrder "position-try-order"
        PositionVisibility "position-visibility"
        ReadingFlow "reading-flow"
        ReadingOrder "reading-order"
        RowRuleBreak "row-rule-break"
        RowRuleColor "row-rule-color"
        RowRuleInsetCapEnd "row-rule-inset-cap-end"
        RowRuleInsetCapStart "row-rule-inset-cap-start"
        RowRuleInsetJunctionEnd "row-rule-inset-junction-end"
        RowRuleInsetJunctionStart "row-rule-inset-junction-start"
        RowRuleStyle "row-rule-style"
        RowRuleVisibilityItems "row-rule-visibility-items"
        RowRuleWidth "row-rule-width"
        RuleOverlap "rule-overlap"
        ScrollAxisLock "scroll-axis-lock"
        ScrollInitialTarget "scroll-initial-target"
        ScrollMarkerGroup "scroll-marker-group"
        ScrollSnapStop "scroll-snap-stop"
        ScrollTargetGroup "scroll-target-group"
        Size "size"
        TimelineScope "timeline-scope"
        TimelineTriggerActivationRangeEnd "timeline-trigger-activation-range-end"
        TimelineTriggerActivationRangeStart "timeline-trigger-activation-range-start"
        TimelineTriggerActiveRangeEnd "timeline-trigger-active-range-end"
        TimelineTriggerActiveRangeStart "timeline-trigger-active-range-start"
        TimelineTriggerName "timeline-trigger-name"
        TimelineTriggerSource "timeline-trigger-source"
        TransformStyle "transform-style"
        TriggerScope "trigger-scope"
        ViewTimelineAxis "view-timeline-axis"
        ViewTimelineInset "view-timeline-inset"
        ViewTimelineName "view-timeline-name"
        ViewTransitionClass "view-transition-class"
        ViewTransitionGroup "view-transition-group"
        ViewTransitionName "view-transition-name"
        ViewTransitionScope "view-transition-scope"
    }
}

/// With `-webkit-`.
const ALSO_PREFIXED: &str = "align-content align-items align-self animation animation-delay animation-direction \
    animation-duration animation-fill-mode animation-iteration-count animation-name animation-play-state \
    animation-timing-function app-region appearance backface-visibility background-clip background-origin \
    background-size border-bottom-left-radius border-bottom-right-radius \
    border-top-left-radius border-top-right-radius box-decoration-break box-shadow box-sizing clip-path column-count \
    column-gap column-rule column-rule-color column-rule-style column-rule-width column-span column-width columns filter \
    flex flex-basis flex-direction flex-flow flex-grow flex-shrink flex-wrap font-feature-settings hyphenate-character \
    justify-content line-break mask mask-clip mask-image mask-origin mask-position mask-repeat mask-size \
    opacity order perspective perspective-origin print-color-adjust shape-image-threshold shape-margin shape-outside \
    text-emphasis text-emphasis-color text-emphasis-position text-emphasis-style text-orientation text-size-adjust \
    transform transform-origin transform-style transition transition-delay transition-duration transition-property \
    transition-timing-function user-select writing-mode";

const ALIASES: &str = "word-wrap overflow-wrap grid-gap gap grid-row-gap row-gap grid-column-gap column-gap \
    -webkit-logical-width inline-size -webkit-logical-height block-size -webkit-min-logical-width min-inline-size \
    -webkit-min-logical-height min-block-size -webkit-max-logical-width max-inline-size -webkit-max-logical-height max-block-size";

macro_rules! sides {
    ($($before:literal $after:literal $top:ident $right:ident $bottom:ident $left:ident;)+) => {
        [$(
            (concat!($before, "block-start", $after), Id::$top), (concat!($before, "block-end", $after), Id::$bottom),
            (concat!($before, "inline-start", $after), Id::$left), (concat!($before, "inline-end", $after), Id::$right),
        )+]
    };
}

/// The flow-relative properties, and what they set in `Flow::DEFAULT`.
const LOGICAL_SIDES: [(&str, Id); 32] = sides! {
    "margin-" "" MarginTop MarginRight MarginBottom MarginLeft;
    "padding-" "" PaddingTop PaddingRight PaddingBottom PaddingLeft;
    "inset-" "" Top Right Bottom Left;
    "border-" "-width" BorderTopWidth BorderRightWidth BorderBottomWidth BorderLeftWidth;
    "border-" "-style" BorderTopStyle BorderRightStyle BorderBottomStyle BorderLeftStyle;
    "border-" "-color" BorderTopColor BorderRightColor BorderBottomColor BorderLeftColor;
    "scroll-margin-" "" ScrollMarginTop ScrollMarginRight ScrollMarginBottom ScrollMarginLeft;
    "scroll-padding-" "" ScrollPaddingTop ScrollPaddingRight ScrollPaddingBottom ScrollPaddingLeft;
};
const LOGICAL: [(&str, Id); 20] = [
    ("inline-size", Id::Width),
    ("block-size", Id::Height),
    ("min-inline-size", Id::MinWidth),
    ("min-block-size", Id::MinHeight),
    ("max-inline-size", Id::MaxWidth),
    ("max-block-size", Id::MaxHeight),
    ("overflow-inline", Id::OverflowX),
    ("overflow-block", Id::OverflowY),
    ("overscroll-behavior-inline", Id::OverscrollBehaviorX),
    ("overscroll-behavior-block", Id::OverscrollBehaviorY),
    ("contain-intrinsic-inline-size", Id::ContainIntrinsicWidth),
    ("contain-intrinsic-block-size", Id::ContainIntrinsicHeight),
    ("border-start-start-radius", Id::BorderTopLeftRadius),
    ("border-start-end-radius", Id::BorderTopRightRadius),
    ("border-end-end-radius", Id::BorderBottomRightRadius),
    ("border-end-start-radius", Id::BorderBottomLeftRadius),
    ("corner-start-start-shape", Id::CornerTopLeftShape),
    ("corner-start-end-shape", Id::CornerTopRightShape),
    ("corner-end-end-shape", Id::CornerBottomRightShape),
    ("corner-end-start-shape", Id::CornerBottomLeftShape),
];

fn logical() -> impl Iterator<Item = (&'static str, Id)> {
    LOGICAL_SIDES.into_iter().chain(LOGICAL)
}

impl Id {
    /// Other values depend on these.
    pub(crate) fn is_early(self) -> bool {
        (self as u16) <= Id::WritingMode as u16
            || matches!(self, Id::Color | Id::ColorScheme | Id::Zoom)
    }

    pub(crate) const FONT_OPTIONS: [Id; 8] = [
        Id::FontLanguageOverride,
        Id::FontPalette,
        Id::FontSizeAdjust,
        Id::FontSynthesisSmallCaps,
        Id::FontVariantAlternates,
        Id::FontVariantEastAsian,
        Id::FontVariantEmoji,
        Id::FontVariantPosition,
    ];

    /// Whether the computed values of other properties depend on it.
    pub(crate) fn affects_others(self) -> bool {
        self.is_early() && self != Id::Color
            || Id::FONT_OPTIONS.contains(&self)
            || matches!(
                self,
                Id::Display | Id::Position | Id::Float | Id::Clear | Id::OverflowX | Id::OverflowY
            )
    }

    /// What a flow-relative property sets in `flow`, if it sets this in `Flow::DEFAULT`.
    pub(crate) fn in_flow(self, flow: Flow) -> Id {
        const SIDES: [Id; 8] = [
            Id::MarginTop,
            Id::PaddingTop,
            Id::Top,
            Id::BorderTopWidth,
            Id::BorderTopStyle,
            Id::BorderTopColor,
            Id::ScrollMarginTop,
            Id::ScrollPaddingTop,
        ];
        const AXES: [Id; 6] = [
            Id::Width,
            Id::MinWidth,
            Id::MaxWidth,
            Id::OverflowX,
            Id::OverscrollBehaviorX,
            Id::ContainIntrinsicWidth,
        ];
        let find = |groups: &[Id], size| {
            groups.iter().map(|it| *it as usize).find_map(|first| {
                Some((
                    first,
                    (self as usize).checked_sub(first).filter(|it| *it < size)?,
                ))
            })
        };
        let sides = flow.sides();
        Id::ALL[if let Some((first, side)) = find(&SIDES, 4) {
            first + sides[side]
        } else if let Some((first, axis)) = find(&AXES, 2) {
            first + (axis ^ usize::from(flow.is_vertical()))
        } else if let Some((first, corner)) =
            find(&[Id::BorderTopLeftRadius, Id::CornerTopLeftShape], 4)
        {
            let (a, b) = (sides[(corner + 3) % 4], sides[corner]);
            first + if (a + 1) % 4 == b { b } else { a }
        } else {
            self as usize
        }]
    }

    pub(crate) fn is_animatable(self) -> bool {
        !(Id::TransitionProperty as u16..=Id::AnimationRangeEnd as u16).contains(&(self as u16))
            && !matches!(self, Id::Direction | Id::WritingMode | Id::WillChange)
            && !matches!(
                self,
                Id::ContainerType
                    | Id::ContainerName
                    | Id::Contain
                    | Id::TextOrientation
                    | Id::TextCombineUpright
            )
            && !self.syntax().has_note("x")
    }

    pub(crate) fn is_in_all(self) -> bool {
        !matches!(
            self,
            Id::Direction | Id::UnicodeBidi | Id::UserModify | Id::WebkitBorderImage
        ) && !(Id::WebkitPerspectiveOriginX as u16..=Id::WebkitTransformOriginZ as u16)
            .contains(&(self as u16))
    }

    pub(crate) fn syntax(self) -> &'static Definition {
        LONGHANDS.with(|it| it[self as usize].0)
    }

    /// As it is specified.
    pub(crate) fn initial_source(self) -> &'static str {
        self.syntax()
            .note("i=")
            .unwrap_or_else(|| self.initial_text())
    }

    /// As it is computed.
    pub(crate) fn initial_text(self) -> &'static str {
        LONGHANDS.with(|it| {
            *it[self as usize].1.get_or_init(|| {
                let mut out = Out::new();
                match self.syntax().note("i=").filter(|_| !self.has_type()) {
                    Some(source) => out.extend(
                        self.syntax()
                            .write(source.as_bytes(), Mode::Computed(&Ctx::dummy()))
                            .into_iter()
                            .flatten(),
                    ),
                    None => initial(self).write(&mut out),
                }
                text(out.leak())
            })
        })
    }

    fn write_text(self, text: &str, out: &mut Out) {
        let has_current = bun_core::strings::contains(text.as_bytes(), b"currentcolor");
        match has_current
            .then(|| {
                self.syntax()
                    .write(text.as_bytes(), Mode::Computed(&Ctx::dummy()))
            })
            .flatten()
        {
            Some(resolved) => out.extend(resolved),
            None => out.extend_from_slice(text.as_bytes()),
        }
    }

    /// Of a value that is valid.
    pub(crate) fn parse(self, source: &[u8], cx: &Ctx) -> Option<Value> {
        let computed = || {
            Some(Str::from(text(
                &self.syntax().write(source, Mode::Computed(cx))?,
            )))
        };
        if !self.has_type() {
            return Some(Value::Other(self, computed()?));
        }
        let value = parse_all(source, |p| self.parse_typed(p, cx));
        if !self.is_spelled() {
            return value;
        }
        let (value, mut written) = (value.unwrap_or_else(|| initial(self)), Out::new());
        value.write(&mut written);
        if written == source {
            return Some(value);
        }
        let text = computed()?;
        Some(if written == text.as_bytes() {
            value
        } else {
            Value::Spelled(Rc::new((value, text)))
        })
    }
}

thread_local! {
    static INITIAL: Groups = Groups::default();
    static LONGHANDS: Vec<(&'static Definition, OnceCell<&'static str>)> =
        Id::ALL.iter().filter_map(|id| Some((definition(id.name())?, OnceCell::new()))).collect();
    static PROPERTIES: Map<Name, Prop> = {
        let longhands = Id::ALL.iter().map(|id| (id.name(), Prop::Long(*id)));
        let logical = logical().map(|(name, id)| (name, Prop::Logical(id)));
        let shorthands = (0..).zip(shorthand::definitions()).map(|(index, it)| (it.name, Prop::Short(index)));
        let mut all: Map<_, _> =
            longhands.chain(logical).chain(shorthands).map(|(name, prop)| (Name::new(name.as_bytes()), prop)).collect();
        all.insert(Name::new(b"all"), Prop::All);
        for (alias, name) in aliases() {
            all.insert(Name::new(&alias), all[&Name::new(&name)]);
        }
        all
    };
}

pub(crate) fn logical_props() -> impl Iterator<Item = Prop> {
    logical().map(|it| Prop::Logical(it.1))
}

fn aliases() -> impl Iterator<Item = (Out, Out)> {
    let words = |all: &'static str| {
        all.split_ascii_whitespace()
            .map(|it| it.as_bytes().to_vec())
    };
    let prefixed = words(ALSO_PREFIXED).map(|name| ([b"-webkit-", &name[..]].concat(), name));
    let sides = [
        ("before", "block-start"),
        ("after", "block-end"),
        ("start", "inline-start"),
        ("end", "inline-end"),
    ];
    let groups = [
        ("margin", ""),
        ("padding", ""),
        ("border", ""),
        ("border", "-width"),
        ("border", "-style"),
        ("border", "-color"),
    ];
    let relative = groups.into_iter().flat_map(move |(group, part)| {
        sides.map(|(old, new)| {
            (
                format!("-webkit-{group}-{old}{part}").into_bytes(),
                format!("{group}-{new}{part}").into_bytes(),
            )
        })
    });
    prefixed.chain(relative).chain(
        words(ALIASES)
            .step_by(2)
            .zip(words(ALIASES).skip(1).step_by(2)),
    )
}

pub(crate) fn initial_groups() -> Groups {
    INITIAL.with(Groups::clone)
}

fn initial(id: Id) -> Value {
    INITIAL.with(|initial| initial.get(id))
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Prop {
    Long(Id),
    /// The flow-relative property that sets this one in `Flow::DEFAULT`.
    Logical(Id),
    Short(u8),
    All,
    Custom(Name),
}

impl Prop {
    pub(crate) fn from_name(name: &[u8]) -> Option<Prop> {
        if name.starts_with(b"--") {
            return (name.len() > 2).then(|| Prop::Custom(Name::new(name)));
        }
        PROPERTIES.with(|all| all.get(&Name::lowercase(name)).copied())
    }

    pub(crate) fn name(self) -> &'static str {
        match self {
            Prop::Long(id) => id.name(),
            Prop::Logical(id) => logical().find(|it| it.1 == id).map_or("", |it| it.0),
            Prop::Short(index) => shorthand::definitions()[usize::from(index)].name,
            Prop::All => "all",
            Prop::Custom(_) => "",
        }
    }

    /// Of a longhand.
    pub(crate) fn id(self, flow: Flow) -> Option<Id> {
        match self {
            Prop::Long(id) => Some(id),
            Prop::Logical(id) => Some(id.in_flow(flow)),
            _ => None,
        }
    }

    pub(crate) fn longhands(self, flow: Flow) -> &'static [Id] {
        match self {
            Prop::Short(index) => shorthand::get(index).ids(flow),
            Prop::All => Id::ALL,
            _ => self
                .id(flow)
                .map_or(&[], |id| core::slice::from_ref(&Id::ALL[id as usize])),
        }
    }

    pub(crate) fn accepts(self, source: &[u8]) -> bool {
        match self {
            Prop::Long(id) | Prop::Logical(id) => id.syntax().accepts(source),
            Prop::Short(index) => shorthand::get(index).expand(source).is_some(),
            Prop::All => false,
            Prop::Custom(_) => true,
        }
    }

    /// A value for each of the longhands.
    pub(crate) fn parse(self, source: &[u8], cx: &Ctx, is_valid: bool) -> Option<Rc<[Value]>> {
        let Prop::Short(index) = self else {
            (is_valid || self.accepts(source)).then_some(())?;
            return Some(Rc::new([self.id(cx.flow)?.parse(source, cx)?]));
        };
        let value = |(id, part): (&Id, Option<Part>)| {
            Some(
                part.and_then(|it| id.parse(&it, cx))
                    .unwrap_or_else(|| initial(*id)),
            )
        };
        self.longhands(cx.flow)
            .iter()
            .zip(shorthand::get(index).expand(source)?)
            .map(value)
            .collect()
    }
}

/// With the aliases.
pub(crate) fn property_names() -> Vec<Out> {
    let names = Id::ALL
        .iter()
        .map(|id| id.name())
        .chain(logical().map(|it| it.0))
        .chain(shorthand::definitions().iter().map(|it| it.name));
    names
        .chain(["all"])
        .map(|it| it.as_bytes().to_vec())
        .chain(aliases().map(|it| it.0))
        .collect()
}

// ───────────────────────────── the computed style ─────────────────────────────

#[derive(Clone)]
pub(crate) struct Style {
    pub(crate) groups: Groups,
    pub(crate) customs: Customs,
    pub(crate) deps: Deps,
    /// From `font_describe`.
    pub(crate) font_id: u32,
    pub(crate) metrics: FontMetrics,
    /// The product of the `zoom`s up to the root.
    pub(crate) zoom: f32,
    pub(crate) dark: bool,
    /// What the animations that are in effect count as.
    pub(crate) animates: WillChange,
    /// Whether the font size does not derive from the default one, which is smaller for `monospace`.
    pub(crate) has_absolute_font_size: bool,
    /// Whether `display` was inline-level before it was blockified.
    pub(crate) was_inline: bool,
    /// It has a box of its own, even with `display: inline`.
    pub(crate) is_atomic: bool,
    /// Before they are resolved for layout.
    pub(crate) computed_sides: (Float, Clear),
    pub(crate) look: crate::theme::Look,
    pub(crate) plainness: Plainness,
}

/// What `Style::is_plain` and `Style::is_bare` have found. A copy is made to be changed.
#[derive(Default)]
pub(crate) struct Plainness(
    core::cell::Cell<Option<bool>>,
    core::cell::Cell<Option<bool>>,
);

impl Clone for Plainness {
    fn clone(&self) -> Plainness {
        Plainness::default()
    }
}

impl core::ops::Deref for Style {
    type Target = Groups;
    fn deref(&self) -> &Groups {
        &self.groups
    }
}

impl Style {
    pub(crate) fn display(&self) -> Display {
        self.layout.display.0
    }

    pub(crate) fn color(&self) -> u32 {
        self.ink.color.0
    }

    pub(crate) fn is_rtl(&self) -> bool {
        self.text.direction == Direction::Rtl
    }

    pub(crate) fn flow(&self) -> Flow {
        let (mode, rtl) = (self.text.writing_mode, u8::from(self.is_rtl()));
        Flow(match mode {
            WritingMode::HorizontalTb => rtl,
            WritingMode::VerticalRl | WritingMode::SidewaysRl => 2 + rtl,
            WritingMode::VerticalLr => 4 + rtl,
            WritingMode::SidewaysLr => 5 - rtl,
        })
    }

    pub(crate) fn is_visible(&self) -> bool {
        self.ink.visibility.0 == Visibility::Visible
    }

    pub(crate) fn is_out_of_flow(&self) -> bool {
        matches!(
            self.layout.position,
            PositionKind::Absolute | PositionKind::Fixed
        )
    }

    pub(crate) fn is_positioned(&self) -> bool {
        self.layout.position != PositionKind::Static
    }

    pub(crate) fn is_floating(&self) -> bool {
        self.layout.float != Float::None
    }

    pub(crate) fn is_editable(&self) -> bool {
        self.text.user_modify != UserModify::ReadOnly
    }

    pub(crate) fn scrolls(&self) -> bool {
        self.layout.overflow_x.scrolls() || self.layout.overflow_y.scrolls()
    }

    pub(crate) fn line_height(&self) -> f32 {
        match self.font.line_height {
            LineHeight::Normal => {
                self.metrics.ascent + self.metrics.descent + self.metrics.line_gap
            }
            LineHeight::Number(number) => number * self.font.size.0,
            LineHeight::Px(px) => px,
        }
    }

    pub(crate) fn font_units(&self) -> FontUnits {
        FontUnits {
            size: self.font.size.0,
            weight: self.font.weight.0,
            line_height: self.line_height(),
        }
    }

    pub(crate) fn root_units(&self) -> RootUnits {
        let metrics = [
            self.metrics.x_height,
            self.metrics.zero_advance,
            self.metrics.cap_height,
            self.metrics.ideograph_advance,
        ];
        RootUnits {
            size: self.font.size.0 / self.zoom,
            line_height: self.line_height() / self.zoom,
            metrics: metrics.map(|it| it / self.zoom),
        }
    }

    /// What animations start from.
    pub(crate) fn computed(&self, id: Id) -> Value {
        let mut value = self.get(id);
        if let Value::Opacity(it)
        | Value::FillOpacity(it)
        | Value::StrokeOpacity(it)
        | Value::StopOpacity(it)
        | Value::FloodOpacity(it)
        | Value::ShapeImageThreshold(it) = &mut value
        {
            it.clamp();
        }
        value
    }

    pub(crate) fn border(&self) -> [f32; 4] {
        let l = &self.layout;
        let used =
            |width: BorderWidth, style: BorderStyle| if style.is_none() { 0.0 } else { width.0 };
        [
            used(l.border_top, l.border_top_style),
            used(l.border_right, l.border_right_style),
            used(l.border_bottom, l.border_bottom_style),
            used(l.border_left, l.border_left_style),
        ]
    }

    pub(crate) fn outline_width(&self) -> f32 {
        if self.paint.outline_style == OutlineStyle::None {
            0.0
        } else {
            self.paint.outline_width.0
        }
    }

    pub(crate) fn floats_right(&self) -> bool {
        self.layout.float == Float::Right
    }

    pub(crate) fn clamps_lines(&self) -> bool {
        matches!(
            self.display(),
            Display::WebkitBox | Display::WebkitInlineBox
        ) && self.rare.box_orient == BoxOrient::Vertical
            && self.rare.line_clamp.0.is_some()
    }

    /// What of it applies.
    pub(crate) fn contain(&self) -> Contain {
        use Display as D;
        let (l, mut contain) = (&self.layout, self.layout.contain);
        if contain.is_empty()
            && l.container_type.is_empty()
            && l.content_visibility == ContentVisibility::Visible
        {
            return contain;
        }
        if contain.intersects(Contain::STRICT | Contain::CONTENT)
            || l.content_visibility != ContentVisibility::Visible
        {
            contain |= Contain::LAYOUT | Contain::PAINT | Contain::STYLE;
        }
        if contain.contains(Contain::STRICT)
            || l.container_type.contains(ContainerType::SIZE)
            || l.content_visibility == ContentVisibility::Hidden
        {
            contain |= Contain::SIZE;
        }
        if l.container_type.contains(ContainerType::INLINE_SIZE) {
            contain |= Contain::INLINE_SIZE;
        }
        if l.container_type
            .intersects(ContainerType::SIZE | ContainerType::INLINE_SIZE | ContainerType::ANCHORED)
        {
            contain |= Contain::STYLE;
        }
        match self.display() {
            D::Table | D::InlineTable | D::TableCell => {
                contain - Contain::SIZE - Contain::INLINE_SIZE
            }
            D::Ruby
            | D::RubyText
            | D::TableRowGroup
            | D::TableHeaderGroup
            | D::TableFooterGroup
            | D::TableRow
            | D::TableColumnGroup
            | D::TableColumn => contain & Contain::STYLE,
            display if display.is_inline_box() && !self.is_atomic => contain & Contain::STYLE,
            _ => contain,
        }
    }

    pub(crate) fn letter_spacing(&self) -> f32 {
        self.text.letter_spacing.0.resolve(self.font.size.0)
    }

    pub(crate) fn word_spacing(&self) -> f32 {
        self.text.word_spacing.0.resolve(self.font.size.0)
    }

    /// Whether it is a container for queries about the width and the height.
    pub(crate) fn queried_axes(&self) -> [bool; 2] {
        let kind = self.layout.container_type;
        self.text.writing_mode.turn_axes([
            kind.intersects(ContainerType::SIZE | ContainerType::INLINE_SIZE),
            kind.contains(ContainerType::SIZE),
        ])
    }

    /// Whether a box is where the layout has put it, and only `overflow` can clip it.
    pub(crate) fn is_plain(&self) -> bool {
        self.plainness.0.get().unwrap_or_else(|| {
            let is_plain = !self.has_transform()
                && self.layout.position != PositionKind::Sticky
                && self.effects.clip_path.0.is_none()
                && !self.contain().contains(Contain::PAINT);
            self.plainness.0.set(Some(is_plain));
            is_plain
        })
    }

    /// A rectangle that has no decorations.
    pub(crate) fn is_bare(&self) -> bool {
        self.plainness.1.get().unwrap_or_else(|| {
            let p = &self.paint;
            let is_bare = !self.has_background()
                && p.box_shadow.0.is_empty()
                && self.border() == [0.0; 4]
                && self.outline_width() + p.outline_offset.0 <= 0.0
                && [&p.top_left, &p.top_right, &p.bottom_right, &p.bottom_left]
                    .iter()
                    .all(|it| matches!(it.0.0, Lp::Px(0.0)))
                && self.background.border_image.0.is_none()
                && [Id::BorderShape, Id::BorderImageOutset]
                    .iter()
                    .all(|it| self.other_if_set(*it).is_none());
            self.plainness.1.set(Some(is_bare));
            is_bare
        })
    }

    pub(crate) fn has_transform(&self) -> bool {
        let e = &self.effects;
        !e.transform.0.is_empty()
            || e.translate.0.is_some()
            || e.rotate.0.is_some()
            || e.scale.0.is_some()
            || self.other_if_set(Id::OffsetPath).is_some()
    }

    pub(crate) fn has_mask(&self) -> bool {
        self.mask.image.iter().any(|image| image.0.is_some())
            || self.other_if_set(Id::WebkitMaskBoxImageSource).is_some()
    }

    pub(crate) fn is_pixelated(&self) -> bool {
        matches!(
            self.ink.image_rendering,
            ImageRendering::Pixelated | ImageRendering::CrispEdges
        )
    }

    pub(crate) fn has_effects(&self) -> bool {
        let e = &self.effects;
        e.opacity.0 < 1.0
            || e.blend != Blend::Normal
            || e.clip_path.0.is_some()
            || !e.filter.0.is_empty()
            || self.has_mask()
    }

    pub(crate) fn contains_fixed(&self) -> bool {
        let e = &self.effects;
        self.has_transform()
            || e.perspective.0.is_some()
            || self.wants_3d()
            || !e.filter.0.is_empty()
            || !e.backdrop_filter.0.is_empty()
            || (e.will_change.0 | self.animates)
                .intersects(WillChange::TRANSFORM | WillChange::FILTER | WillChange::CONTAINS)
            || self.contain().intersects(Contain::LAYOUT | Contain::PAINT)
    }

    /// `z_index_applies` to positioned boxes and to flex and grid items.
    pub(crate) fn is_stacking_context(&self, z_index_applies: bool) -> bool {
        let e = &self.effects;
        z_index_applies
            && (self.paint.z_index.0.is_some() || e.will_change.0.contains(WillChange::Z_INDEX))
            || matches!(
                self.layout.position,
                PositionKind::Fixed | PositionKind::Sticky
            )
            || e.opacity.0 < 1.0
            || e.blend != Blend::Normal
            || e.isolation == Isolation::Isolate
            || e.clip_path.0.is_some()
            || (e.will_change.0 | self.animates)
                .intersects(WillChange::OPACITY | WillChange::STACKS | WillChange::POSITION)
            || self.has_mask()
            || self.contains_fixed()
            || self.has_transition_name()
    }

    /// What is behind it is out of reach for the `backdrop-filter` of its descendants.
    pub(crate) fn is_backdrop_root(&self) -> bool {
        let e = &self.effects;
        e.clip_path.0.is_some()
            || !e.backdrop_filter.0.is_empty()
            || (e.will_change.0 | self.animates)
                .intersects(WillChange::OPACITY | WillChange::FILTER)
            || self.has_transition_name()
    }

    pub(crate) fn has_transition_name(&self) -> bool {
        self.other_if_set(Id::ViewTransitionName)
            .is_some_and(|it| it != "none")
    }

    /// From the coordinates of a box of this size, whose top left corner is the origin.
    pub(crate) fn transform(&self, width: f32, height: f32) -> crate::abi::Matrix {
        let e = &self.effects;
        if self.is_3d() {
            let matrix = self.transform_3d(
                crate::abi::Rect {
                    x: 0.0,
                    y: 0.0,
                    width,
                    height,
                },
                None,
            );
            return crate::three_d::affine(&matrix)
                .unwrap_or_else(|| crate::transform::flattened(&matrix));
        }
        let [x, y] = e.origin.0.resolve(width, height);
        let mut matrix = [1.0, 0.0, 0.0, 1.0, x, y];
        for part in [&e.translate.0, &e.rotate.0, &e.scale.0]
            .into_iter()
            .flatten()
        {
            matrix = multiply(&matrix, &part.matrix(width, height));
        }
        matrix = multiply(&matrix, &e.transform.matrix(width, height));
        multiply(&matrix, &[1.0, 0.0, 0.0, 1.0, -x, -y])
    }
}
