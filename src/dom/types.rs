//! The values that only a few properties have.

use std::io::Write as _;
use std::rc::Rc;

use bun_css::Token;
use bun_css::properties::font::{FontFamily, FontStretch as CssFontStretch, GenericFontFamily};

use crate::abi;
use crate::calc::{Kind, Node, Options};
use crate::counter_style::CounterStyle;
use crate::order::Order as _;
pub(crate) use crate::transform::{
    Rotate, Scale, Transform, TransformOrigin, Transforms, Translate,
};
use crate::values::*;

keywords! {
    PositionKind { Static = "static", Relative = "relative", Absolute = "absolute", Fixed = "fixed", Sticky = "sticky" | "-webkit-sticky" }
    Float { None = "none", Left = "left", Right = "right", InlineStart = "inline-start", InlineEnd = "inline-end" }
    Clear { None = "none", Left = "left", Right = "right", Both = "both", InlineStart = "inline-start", InlineEnd = "inline-end" }
    BoxSizing { ContentBox = "content-box", BorderBox = "border-box" }
    Overflow { Visible = "visible", Hidden = "hidden", Clip = "clip", Scroll = "scroll", Auto = "auto" | "overlay" }
    BorderStyle { None = "none", Hidden = "hidden", Solid = "solid", Dotted = "dotted", Dashed = "dashed", Double = "double",
        Groove = "groove", Ridge = "ridge", Inset = "inset", Outset = "outset" }
    OutlineStyle { None = "none", Auto = "auto", Solid = "solid", Dotted = "dotted", Dashed = "dashed", Double = "double",
        Groove = "groove", Ridge = "ridge", Inset = "inset", Outset = "outset" }
    FlexDirection { Row = "row", RowReverse = "row-reverse", Column = "column", ColumnReverse = "column-reverse" }
    ColumnWrap { Auto = "auto", Nowrap = "nowrap", Wrap = "wrap" }
    ColumnFill { Balance = "balance", Auto = "auto" }
    ColumnSpan { None = "none", All = "all" }
    BreakBetween { Auto = "auto", Avoid = "avoid", AvoidPage = "avoid-page", Page = "page", Left = "left", Right = "right", Recto = "recto",
        Verso = "verso", AvoidColumn = "avoid-column", Column = "column" }
    BreakInside { Auto = "auto", Avoid = "avoid", AvoidPage = "avoid-page", AvoidColumn = "avoid-column" }
    BoxOrient { Horizontal = "horizontal" | "inline-axis", Vertical = "vertical" | "block-axis" }
    Direction { Ltr = "ltr", Rtl = "rtl" }
    UnicodeBidi { Normal = "normal", Embed = "embed", Isolate = "isolate" | "-webkit-isolate", BidiOverride = "bidi-override",
        IsolateOverride = "isolate-override", Plaintext = "plaintext" | "-webkit-plaintext" }
    TextAlign { Start = "start" | "-webkit-auto", End = "end", Left = "left", Right = "right", Center = "center", Justify = "justify",
        WebkitLeft = "-webkit-left", WebkitRight = "-webkit-right", WebkitCenter = "-webkit-center",
        MatchParent = "match-parent" | "-webkit-match-parent", InternalCenter = "-internal-center" }
    TextAlignLast { Auto = "auto", Start = "start", End = "end", Left = "left", Right = "right", Center = "center", Justify = "justify" }
    TextTransform { None = "none", Capitalize = "capitalize", Uppercase = "uppercase", Lowercase = "lowercase", MathAuto = "math-auto" }
    WhiteSpaceCollapse { Collapse = "collapse", Preserve = "preserve", PreserveBreaks = "preserve-breaks", BreakSpaces = "break-spaces" }
    TextWrapMode { Wrap = "wrap", Nowrap = "nowrap" }
    TextWrapStyle { Auto = "auto", Balance = "balance", Pretty = "pretty", Stable = "stable" }
    WordBreak { Normal = "normal", BreakAll = "break-all", KeepAll = "keep-all", BreakWord = "break-word", AutoPhrase = "auto-phrase" }
    OverflowWrap { Normal = "normal", BreakWord = "break-word", Anywhere = "anywhere" }
    LineBreak { Auto = "auto", Loose = "loose", Normal = "normal", Strict = "strict", Anywhere = "anywhere", AfterWhiteSpace = "after-white-space" }
    Hyphens { Manual = "manual", None = "none", Auto = "auto" }
    TextOverflow { Clip = "clip", Ellipsis = "ellipsis" }
    TextSecurity { None = "none", Disc = "disc", Circle = "circle", Square = "square" }
    Visibility { Visible = "visible", Hidden = "hidden", Collapse = "collapse" }
    PointerEvents { Auto = "auto", None = "none", VisiblePainted = "visiblepainted", VisibleFill = "visiblefill",
        VisibleStroke = "visiblestroke", Visible = "visible", Painted = "painted", Fill = "fill", Stroke = "stroke",
        All = "all", BoundingBox = "bounding-box" }
    UserSelect { Auto = "auto", None = "none", Text = "text", All = "all", Contain = "contain" }
    UserModify { ReadOnly = "read-only", ReadWrite = "read-write", PlaintextOnly = "read-write-plaintext-only" }
    AppRegion { None = "none", Drag = "drag", NoDrag = "no-drag" }
    ListStylePosition { Outside = "outside", Inside = "inside" }
    BorderCollapse { Separate = "separate", Collapse = "collapse" }
    CaptionSide { Top = "top", Bottom = "bottom" }
    TableLayout { Auto = "auto", Fixed = "fixed" }
    ImageRendering { Auto = "auto", Smooth = "smooth", Pixelated = "pixelated", CrispEdges = "crisp-edges" | "-webkit-optimize-contrast" }
    ObjectFit { Fill = "fill", Contain = "contain", Cover = "cover", None = "none", ScaleDown = "scale-down" }
    ScrollbarWidth { Auto = "auto", Thin = "thin", None = "none" }
    ContentVisibility { Visible = "visible", Auto = "auto", Hidden = "hidden" }
    FieldSizing { Fixed = "fixed", Content = "content" }
    Resize { None = "none", Both = "both", Horizontal = "horizontal", Vertical = "vertical", Block = "block", Inline = "inline" }
    BoxArea { BorderBox = "border-box" | "border", StrokeBox = "stroke-box", ViewBox = "view-box", FillBox = "fill-box", PaddingBox = "padding-box" | "padding",
        ContentBox = "content-box" | "content", Text = "text", BorderArea = "border-area", BorderAreaAndText = "border-area text", NoClip = "no-clip", MarginBox = "margin-box" }
    Attachment { Scroll = "scroll", Fixed = "fixed", Local = "local" }
    RepeatKind { Repeat = "repeat", Space = "space", Round = "round", NoRepeat = "no-repeat" }
    DecorationStyle { Solid = "solid", Double = "double", Dotted = "dotted", Dashed = "dashed", Wavy = "wavy" }
    DecorationBreak { Slice = "slice", Clone = "clone" }
    Isolation { Auto = "auto", Isolate = "isolate" }
    Backface { Visible = "visible", Hidden = "hidden" }
    Blend { Normal = "normal", Multiply = "multiply", Screen = "screen", Overlay = "overlay", Darken = "darken",
        Lighten = "lighten", ColorDodge = "color-dodge", ColorBurn = "color-burn", HardLight = "hard-light",
        SoftLight = "soft-light", Difference = "difference", Exclusion = "exclusion", Hue = "hue",
        Saturation = "saturation", Color = "color", Luminosity = "luminosity", PlusLighter = "plus-lighter" }
    MaskComposite { Add = "add" | "source-over", Subtract = "subtract" | "source-out", Intersect = "intersect" | "source-in" | "destination-in",
        Exclude = "exclude" | "xor" }
    MaskMode { MatchSource = "match-source", Alpha = "alpha", Luminance = "luminance" }
    FontKerning { Auto = "auto", Normal = "normal", None = "none" }
    AutoOrNone { Auto = "auto", None = "none" }
    FontCaps { Normal = "normal", SmallCaps = "small-caps", AllSmallCaps = "all-small-caps", PetiteCaps = "petite-caps",
        AllPetiteCaps = "all-petite-caps", Unicase = "unicase", TitlingCaps = "titling-caps" }
    ScrollBehavior { Auto = "auto", Smooth = "smooth" }
    Overscroll { Auto = "auto", Contain = "contain", None = "none" }
    AnimationDirection { Normal = "normal", Reverse = "reverse", Alternate = "alternate", AlternateReverse = "alternate-reverse" }
    FillMode { None = "none", Forwards = "forwards", Backwards = "backwards", Both = "both" }
    PlayState { Running = "running", Paused = "paused" }
    TransitionBehavior { Normal = "normal", AllowDiscrete = "allow-discrete" }
    FillRule { Nonzero = "nonzero", Evenodd = "evenodd" }
    WritingMode { HorizontalTb = "horizontal-tb" | "lr" | "lr-tb" | "rl" | "rl-tb", VerticalRl = "vertical-rl" | "tb" | "tb-rl",
        VerticalLr = "vertical-lr", SidewaysRl = "sideways-rl", SidewaysLr = "sideways-lr" }
    TextOrientation { Mixed = "mixed", Upright = "upright", Sideways = "sideways" | "sideways-right" }
    TextJustify { Auto = "auto", None = "none", InterWord = "inter-word", InterCharacter = "inter-character" | "distribute" }
    TextAutospace { NoAutospace = "no-autospace", Normal = "normal" }
    TextSpacingTrim { Normal = "normal", SpaceAll = "space-all", SpaceFirst = "space-first", TrimStart = "trim-start" }
    TextBoxTrim { None = "none", TrimStart = "trim-start", TrimEnd = "trim-end", TrimBoth = "trim-both" }
    OverEdge { Auto = "auto", Text = "text", Cap = "cap", Ex = "ex" }
    BaselineSource { Auto = "auto", First = "first", Last = "last" }
    RubyAlign { SpaceAround = "space-around", Start = "start", Center = "center", SpaceBetween = "space-between" }
    RubyPosition { Over = "over" | "before", Under = "under" | "after" }
    RubyOverhang { Auto = "auto", Spaces = "spaces" | "none" }
    TextCombine { None = "none", All = "all" }
    Appearance { None = "none", Auto = "auto", Button = "button", Textfield = "textfield", Checkbox = "checkbox", Radio = "radio",
        Menulist = "menulist", MenulistButton = "menulist-button", Listbox = "listbox", Searchfield = "searchfield",
        Textarea = "textarea", Meter = "meter", ProgressBar = "progress-bar", BaseSelect = "base-select" }
    Extent { ClosestSide = "closest-side", FarthestSide = "farthest-side", ClosestCorner = "closest-corner", FarthestCorner = "farthest-corner" }
    Interactivity { Auto = "auto", Inert = "inert", InertSubtree = "-internal-inert", AutoInInertSubtree = "-internal-auto", Escapes = "-internal-escapes" }
    SkipInk { Auto = "auto", None = "none", All = "all" }
    InterpolateSize { NumericOnly = "numeric-only", AllowKeywords = "allow-keywords" }
    OverlayKind { None = "none", Auto = "auto" }
    CursorName { Auto = "auto", Default = "default", None = "none", ContextMenu = "context-menu", Help = "help", Pointer = "pointer",
        Progress = "progress", Wait = "wait", Cell = "cell", Crosshair = "crosshair", Text = "text", VerticalText = "vertical-text",
        Alias = "alias", Copy = "copy", Move = "move", NoDrop = "no-drop", NotAllowed = "not-allowed",
        Grab = "grab" | "-webkit-grab", Grabbing = "grabbing" | "-webkit-grabbing", EResize = "e-resize", NResize = "n-resize",
        NeResize = "ne-resize", NwResize = "nw-resize", SResize = "s-resize", SeResize = "se-resize", SwResize = "sw-resize",
        WResize = "w-resize", EwResize = "ew-resize", NsResize = "ns-resize", NeswResize = "nesw-resize",
        NwseResize = "nwse-resize", ColResize = "col-resize", RowResize = "row-resize", AllScroll = "all-scroll",
        ZoomIn = "zoom-in" | "-webkit-zoom-in", ZoomOut = "zoom-out" | "-webkit-zoom-out" }
}

flags!(DecorationLine, "none" { UNDERLINE = 0 "underline", OVERLINE = 1 "overline", LINE_THROUGH = 2 "line-through", BLINK = 3 "blink" });
flags!(Contain, "none" { SIZE = 0 "size", INLINE_SIZE = 1 "inline-size", LAYOUT = 2 "layout", STYLE = 3 "style", PAINT = 4 "paint",
    STRICT = 5 "strict", CONTENT = 6 "content" });
flags!(ContainerType, "normal" { SIZE = 0 "size", INLINE_SIZE = 1 "inline-size", SCROLL_STATE = 2 "scroll-state", ANCHORED = 3 "anchored" });
flags!(ScrollbarGutter, "auto" { STABLE = 0 "stable", BOTH_EDGES = 1 "both-edges" });
flags!(ColorScheme, "normal" { LIGHT = 0 "light", DARK = 1 "dark", ONLY = 2 "only" });
flags!(UnderlinePosition, "auto" { FROM_FONT = 0 "from-font", UNDER = 1 "under", LEFT = 2 "left", RIGHT = 3 "right" });
#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) struct GridAutoFlow {
    pub(crate) is_column: bool,
    pub(crate) is_dense: bool,
}

impl Css for GridAutoFlow {
    fn parse(p: &mut P, _: &Ctx) -> Option<Self> {
        let is_dense = keyword(p, "dense");
        let is_column = keyword(p, "column");
        let has_axis = is_column || keyword(p, "row");
        (is_dense || has_axis).then(|| GridAutoFlow {
            is_column,
            is_dense: is_dense || keyword(p, "dense"),
        })
    }
    fn write(&self, out: &mut Out) {
        out.extend(
            ["row", "dense", "column", "column dense"]
                [usize::from(self.is_column) * 2 + usize::from(self.is_dense)]
            .bytes(),
        );
    }
}

flags!(Ligatures, "normal" { NONE = 0 "none", COMMON = 1 "common-ligatures", NO_COMMON = 2 "no-common-ligatures",
    DISCRETIONARY = 3 "discretionary-ligatures", NO_DISCRETIONARY = 4 "no-discretionary-ligatures",
    HISTORICAL = 5 "historical-ligatures", NO_HISTORICAL = 6 "no-historical-ligatures", CONTEXTUAL = 7 "contextual",
    NO_CONTEXTUAL = 8 "no-contextual" });
flags!(Numeric, "normal" { LINING = 0 "lining-nums", OLDSTYLE = 1 "oldstyle-nums", PROPORTIONAL = 2 "proportional-nums",
    TABULAR = 3 "tabular-nums", DIAGONAL = 4 "diagonal-fractions", STACKED = 5 "stacked-fractions", ORDINAL = 6 "ordinal",
    SLASHED_ZERO = 7 "slashed-zero" });
flags!(ScrollSnapType, "none" { X = 0 "x", Y = 1 "y", BLOCK = 2 "block", INLINE = 3 "inline", BOTH = 4 "both",
    MANDATORY = 5 "mandatory", PROXIMITY = 6 "proximity" });

keywords! { SnapAlign { None = "none", Start = "start", End = "end", Center = "center" } }

impl Overflow {
    pub(crate) fn scrolls(self) -> bool {
        matches!(self, Overflow::Hidden | Overflow::Scroll | Overflow::Auto)
    }
}

impl BorderStyle {
    pub(crate) fn is_none(self) -> bool {
        matches!(self, BorderStyle::None | BorderStyle::Hidden)
    }
}

impl WhiteSpaceCollapse {
    pub(crate) fn preserves_spaces(self) -> bool {
        matches!(self, Self::Preserve | Self::BreakSpaces)
    }
}

/// `visibility` is visible for the whole of a transition from or to `visible`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Visible(pub(crate) Visibility);

impl Css for Visible {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        Visibility::parse(p, cx).map(Visible)
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        let visible = Visible(Visibility::Visible);
        let Mixing::Lerp(t) = t else { return None };
        (*self == visible || *to == visible).then_some(match t {
            ..=0.0 => *self,
            1.0.. => *to,
            _ => visible,
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Cursor(pub(crate) CursorName);

impl Css for Cursor {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        while Image::parse(p, cx).is_some() {
            let _ = (number(p, cx), number(p, cx));
            comma(p).then_some(())?;
        }
        CursorName::parse(p, cx).map(Cursor)
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
    }
}

// ───────────────────────────── display ─────────────────────────────

keywords! {
    Display {
        None = "none", Contents = "contents", Inline = "inline", Block = "block",
        Ruby = "ruby", BlockRuby = "block ruby", RubyText = "ruby-text", Math = "math", BlockMath = "block math",
        InlineListItem = "inline list-item", FlowRootListItem = "flow-root list-item", InlineBlockListItem = "inline flow-root list-item",
        ListItem = "list-item", InlineBlock = "inline-block", FlowRoot = "flow-root",
        Flex = "flex" | "-webkit-flex", InlineFlex = "inline-flex" | "-webkit-inline-flex",
        WebkitBox = "-webkit-box", WebkitInlineBox = "-webkit-inline-box",
        Grid = "grid", InlineGrid = "inline-grid", Table = "table", InlineTable = "inline-table",
        TableRowGroup = "table-row-group", TableHeaderGroup = "table-header-group", TableFooterGroup = "table-footer-group",
        TableRow = "table-row", TableCell = "table-cell", TableColumnGroup = "table-column-group",
        TableColumn = "table-column", TableCaption = "table-caption",
    }
}

impl Display {
    pub(crate) fn is_inline_level(self) -> bool {
        use Display as D;
        matches!(
            self,
            D::Inline
                | D::InlineBlock
                | D::InlineFlex
                | D::WebkitInlineBox
                | D::InlineGrid
                | D::InlineTable
        ) || matches!(
            self,
            D::Ruby | D::RubyText | D::Math | D::InlineListItem | D::InlineBlockListItem
        )
    }

    pub(crate) fn is_list_item(self) -> bool {
        matches!(
            self,
            Display::ListItem
                | Display::InlineListItem
                | Display::FlowRootListItem
                | Display::InlineBlockListItem
        )
    }

    /// Whether the contents are on the lines around it.
    pub(crate) fn is_inline_box(self) -> bool {
        matches!(
            self,
            Display::Inline | Display::Ruby | Display::InlineListItem
        )
    }

    pub(crate) fn can_skip_contents(self) -> bool {
        use Display::*;
        !self.is_inline_box()
            && !matches!(
                self,
                None | Contents
                    | RubyText
                    | Table
                    | InlineTable
                    | TableRowGroup
                    | TableHeaderGroup
                    | TableFooterGroup
                    | TableRow
                    | TableColumnGroup
                    | TableColumn
            )
    }

    pub(crate) fn blockified(self) -> Display {
        use Display as D;
        match self {
            D::InlineFlex => D::Flex,
            D::WebkitInlineBox => D::WebkitBox,
            D::InlineGrid => D::Grid,
            D::InlineTable => D::Table,
            D::Ruby => D::BlockRuby,
            D::Math => D::BlockMath,
            D::InlineListItem => D::ListItem,
            D::InlineBlockListItem => D::FlowRootListItem,
            D::None
            | D::Contents
            | D::ListItem
            | D::FlowRoot
            | D::BlockRuby
            | D::BlockMath
            | D::FlowRootListItem => self,
            D::Flex | D::WebkitBox | D::Grid | D::Table => self,
            _ => D::Block,
        }
    }

    pub(crate) fn inlinified(self) -> Display {
        use Display as D;
        match self {
            D::Flex => D::InlineFlex,
            D::WebkitBox => D::WebkitInlineBox,
            D::Grid => D::InlineGrid,
            D::Table => D::InlineTable,
            D::BlockRuby => D::Ruby,
            D::BlockMath => D::Math,
            D::ListItem => D::InlineListItem,
            D::FlowRootListItem => D::InlineBlockListItem,
            D::Block | D::FlowRoot => D::InlineBlock,
            _ => self,
        }
    }

    pub(crate) fn blockifies_children(self) -> bool {
        use Display as D;
        matches!(
            self,
            D::Flex
                | D::InlineFlex
                | D::WebkitBox
                | D::WebkitInlineBox
                | D::Grid
                | D::InlineGrid
                | D::Math
                | D::BlockMath
        )
    }

    pub(crate) fn is_math(self) -> bool {
        matches!(self, Display::Math | Display::BlockMath)
    }

    pub(crate) fn is_row_group(self) -> bool {
        use Display as D;
        matches!(
            self,
            D::TableRowGroup | D::TableHeaderGroup | D::TableFooterGroup
        )
    }
}

/// With the multi-keyword syntax, and kept for the whole of a transition from or to `none`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct DisplayValue(pub(crate) Display);

impl Css for DisplayValue {
    fn parse(p: &mut P, _: &Ctx) -> Option<Self> {
        let first = ident(p)?;
        let Some(second) = ident(p) else {
            return match eq(first, "flow") {
                true => Some(DisplayValue(Display::Block)),
                false => Display::from_name(first).map(DisplayValue),
            };
        };
        let (mut outside, mut inside, mut item) = (None, None, None);
        for name in [Some(first), Some(second), ident(p)].into_iter().flatten() {
            let repeats = match () {
                () if eq(name, "inline") || eq(name, "block") => {
                    outside.replace(eq(name, "inline")).is_some()
                }
                () if eq(name, "list-item") => item.replace(()).is_some(),
                () if eq(name, "flow") => inside.replace(Display::Block).is_some(),
                () => inside.replace(Display::from_name(name)?).is_some(),
            };
            (!repeats).then_some(())?;
        }
        let (inline, inside) = (outside == Some(true), inside.unwrap_or(Display::Block));
        Some(DisplayValue(match (inline, inside) {
            (false, Display::Block) if item.is_some() => Display::ListItem,
            (true, Display::Block) if item.is_some() => Display::InlineListItem,
            (false, Display::FlowRoot) if item.is_some() => Display::FlowRootListItem,
            (true, Display::FlowRoot) if item.is_some() => Display::InlineBlockListItem,
            _ if item.is_some() => return None,
            (true, Display::Ruby | Display::Math) => inside,
            (false, Display::Ruby | Display::Math) => inside.blockified(),
            (true, Display::Block) => Display::Inline,
            (true, Display::FlowRoot) => Display::InlineBlock,
            (true, Display::Flex) => Display::InlineFlex,
            (true, Display::Grid) => Display::InlineGrid,
            (true, Display::Table) => Display::InlineTable,
            (false, Display::Block | Display::FlowRoot | Display::Flex) => inside,
            (false, Display::Grid | Display::Table) => inside,
            _ => return None,
        }))
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
    }
}

// ───────────────────────────── alignment ─────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum AlignmentSafety {
    /// The children of `justify-items` inherit it.
    Legacy,
    Default,
    Safe,
    Unsafe,
}

fn safety(p: &mut P) -> AlignmentSafety {
    match () {
        () if keyword(p, "safe") => AlignmentSafety::Safe,
        () if keyword(p, "unsafe") => AlignmentSafety::Unsafe,
        () => AlignmentSafety::Default,
    }
}

keywords! {
    AlignName {
        Auto = "auto", Normal = "normal", Stretch = "stretch", Baseline = "baseline", LastBaseline = "last baseline",
        Center = "center", Start = "start", End = "end", SelfStart = "self-start", SelfEnd = "self-end",
        FlexStart = "flex-start", FlexEnd = "flex-end", Left = "left", Right = "right",
        SpaceBetween = "space-between", SpaceAround = "space-around", SpaceEvenly = "space-evenly",
        AnchorCenter = "anchor-center",
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Align(pub(crate) AlignName, pub(crate) AlignmentSafety);

impl Align {
    pub(crate) const AUTO: Align = Align(AlignName::Auto, AlignmentSafety::Default);
    pub(crate) const NORMAL: Align = Align(AlignName::Normal, AlignmentSafety::Default);

    pub(crate) fn safe(name: AlignName) -> Align {
        Align(name, AlignmentSafety::Safe)
    }

    pub(crate) fn is_safe(self) -> bool {
        self.1 == AlignmentSafety::Safe
    }

    pub(crate) fn is_legacy(self) -> bool {
        self.1 == AlignmentSafety::Legacy
    }

    pub(crate) fn is_unsafe(self) -> bool {
        self.1 == AlignmentSafety::Unsafe
    }

    /// In terms of the `start` and the `end` of the container, if there is so much `free` space.
    pub(crate) fn resolved(self, axis: usize, rtl: bool, starts_far: bool, free: f32) -> AlignName {
        let pick = |is_end: bool| {
            if is_end {
                AlignName::End
            } else {
                AlignName::Start
            }
        };
        match self.0 {
            _ if self.is_safe() && free < 0.0 => AlignName::Start,
            AlignName::FlexStart => AlignName::Start,
            AlignName::FlexEnd => AlignName::End,
            AlignName::Left => pick(axis == 0 && rtl),
            AlignName::Right => pick(axis == 0 && !rtl),
            AlignName::SelfStart => pick((axis == 0 && rtl) != starts_far),
            AlignName::SelfEnd => pick((axis == 0 && rtl) == starts_far),
            AlignName::AnchorCenter => AlignName::Center,
            name => name,
        }
    }
}

impl Css for Align {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Align> {
        if keyword(p, "legacy") {
            let inherited = || {
                cx.uses(Deps::PARENT);
                let parent = (cx.parent)(crate::properties::Id::JustifyItems);
                let name = parent
                    .strip_prefix(b"legacy ")
                    .and_then(AlignName::from_name);
                name.map_or(Align::NORMAL, |it| Align(it, AlignmentSafety::Legacy))
            };
            return Some(
                AlignName::parse(p, cx)
                    .map_or_else(inherited, |it| Align(it, AlignmentSafety::Legacy)),
            );
        }
        let safety = safety(p);
        if keyword(p, "last") {
            return keyword(p, "baseline").then_some(Align(AlignName::LastBaseline, safety));
        }
        if keyword(p, "first") {
            return keyword(p, "baseline").then_some(Align(AlignName::Baseline, safety));
        }
        Some(Align(
            AlignName::parse(p, cx)?,
            if keyword(p, "legacy") {
                AlignmentSafety::Legacy
            } else {
                safety
            },
        ))
    }
    fn write(&self, out: &mut Out) {
        out.extend_from_slice(match self.1 {
            AlignmentSafety::Safe => b"safe ",
            AlignmentSafety::Unsafe => b"unsafe ",
            AlignmentSafety::Legacy => b"legacy ",
            AlignmentSafety::Default => b"",
        });
        self.0.write(out);
    }
}

keywords! {
    VerticalAlignName { Baseline = "baseline", Sub = "sub", Super = "super", TextTop = "text-top", TextBottom = "text-bottom",
        Middle = "middle" | "-webkit-baseline-middle", Top = "top", Bottom = "bottom" }
}

#[derive(Clone, PartialEq)]
pub(crate) enum VerticalAlign {
    Keyword(VerticalAlignName),
    Length(Lp),
}

impl Css for VerticalAlign {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        (VerticalAlignName::parse(p, cx).map(VerticalAlign::Keyword))
            .or_else(|| Lp::parse(p, cx).map(VerticalAlign::Length))
    }
    fn write(&self, out: &mut Out) {
        match self {
            VerticalAlign::Keyword(name) => name.write(out),
            VerticalAlign::Length(length) => length.write(out),
        }
    }
}

#[derive(Clone, PartialEq)]
pub(crate) struct TextIndent {
    pub(crate) length: Lp,
    pub(crate) hangs: bool,
    pub(crate) each_line: bool,
}

impl Css for TextIndent {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        let (mut length, mut hangs, mut each_line) = (None, false, false);
        loop {
            match () {
                () if !hangs && keyword(p, "hanging") => hangs = true,
                () if !each_line && keyword(p, "each-line") => each_line = true,
                () if length.is_none() => length = Some(attempt(p, |p| Lp::parse(p, cx))?),
                () => {
                    return Some(TextIndent {
                        length: length?,
                        hangs,
                        each_line,
                    });
                }
            }
        }
    }
    fn write(&self, out: &mut Out) {
        self.length.write(out);
        out.extend_from_slice(if self.hangs { b" hanging" } else { b"" });
        out.extend_from_slice(if self.each_line { b" each-line" } else { b"" });
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        ((self.hangs, self.each_line) == (to.hangs, to.each_line)).then_some(())?;
        Some(TextIndent {
            length: self.length.lerp(&to.length, t)?,
            ..*to
        })
    }
}

#[derive(Clone, PartialEq)]
pub(crate) struct Quoted(pub(crate) Str);

impl Css for Quoted {
    fn parse(p: &mut P, _: &Ctx) -> Option<Self> {
        Some(Quoted(text(string(p)?).into()))
    }
    fn write(&self, out: &mut Out) {
        write_string(self.0.as_bytes(), out);
    }
}

/// And whether the under edge is `alphabetic`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct TextBoxEdge(pub(crate) OverEdge, pub(crate) bool);

impl Css for TextBoxEdge {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        let over = OverEdge::parse(p, cx)?;
        let is_alphabetic = over != OverEdge::Auto && keyword(p, "alphabetic");
        let is_complete =
            is_alphabetic || over == OverEdge::Auto || keyword(p, "text") || over == OverEdge::Text;
        is_complete.then_some(TextBoxEdge(over, is_alphabetic))
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
        out.extend_from_slice(match (self.0, self.1) {
            (_, true) => b" alphabetic",
            (OverEdge::Cap | OverEdge::Ex, _) => b" text",
            _ => b"",
        });
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) struct InitialLetter {
    pub(crate) size: f32,
    pub(crate) sink: i32,
    keyword: &'static str,
}

impl Css for InitialLetter {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        let named = |p: &mut P| ["drop", "raise"].into_iter().find(|it| keyword(p, it));
        let before = named(p);
        let size = number(p, cx).filter(|it| *it >= 1.0)?;
        let keyword = before.or_else(|| named(p)).unwrap_or_default();
        let sink = match keyword {
            "raise" => 1,
            "" if !p.is_exhausted() => integer(p, cx).filter(|it| *it >= 1)?,
            _ => 0,
        };
        Some(InitialLetter {
            size,
            sink,
            keyword,
        })
    }
    fn write(&self, out: &mut Out) {
        write_number(self.size, out);
        if !self.keyword.is_empty() {
            _ = write!(out, " {}", self.keyword);
        } else if self.sink > 0 {
            _ = write!(out, " {}", self.sink);
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) struct AspectRatio {
    pub(crate) auto: bool,
    pub(crate) ratio: Option<[f32; 2]>,
}

impl AspectRatio {
    pub(crate) fn value(self) -> Option<f32> {
        let [width, height] = self.ratio?;
        (width > 0.0 && height > 0.0).then_some(width / height)
    }
}

impl Css for AspectRatio {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        let before = keyword(p, "auto");
        let ratio = match quantity(p, cx, Kind::Number, 0.0) {
            Some(width) if delim(p, b'/') => Some([width, quantity(p, cx, Kind::Number, 0.0)?]),
            Some(width) => Some([width, 1.0]),
            None => None,
        };
        let auto = before || keyword(p, "auto");
        (auto || ratio.is_some()).then_some(AspectRatio { auto, ratio })
    }
    fn write(&self, out: &mut Out) {
        if self.auto {
            out.extend_from_slice(if self.ratio.is_some() {
                b"auto "
            } else {
                b"auto"
            });
        }
        if let Some(ratio) = &self.ratio {
            write_list(ratio, " / ", out, f32::write);
        }
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        let ratio = t.of(self.value()?.ln(), to.value()?.ln()).exp();
        (self.auto == to.auto && matches!(t, Mixing::Lerp(_))).then_some(AspectRatio {
            auto: to.auto,
            ratio: Some([ratio, 1.0]),
        })
    }
}

/// `contain-intrinsic-width` or `-height`.
#[derive(Clone, Copy, PartialEq)]
pub(crate) struct IntrinsicSize {
    pub(crate) remembers: bool,
    pub(crate) length: Option<f32>,
}

impl Css for IntrinsicSize {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        let remembers = keyword(p, "auto");
        let length = NoneOr::<PositivePx>::parse(p, cx)?.0.map(|length| length.0);
        Some(IntrinsicSize { remembers, length })
    }
    fn write(&self, out: &mut Out) {
        if self.remembers {
            out.extend_from_slice(b"auto ");
        }
        NoneOr(self.length.map(Px)).write(out);
    }
}

// ───────────────────────────── anchors ─────────────────────────────

pub(crate) fn dashed_ident(p: &mut P) -> Option<Str> {
    attempt(p, |p| {
        let name = p.expect_ident().ok()?;
        name.starts_with(b"--").then(|| text(name).into())
    })
}

#[derive(Clone, PartialEq)]
pub(crate) enum Inset {
    Auto,
    Length(Lp),
    Anchor(Rc<Node>),
}

impl Inset {
    fn new(node: Node) -> Inset {
        if node.has_anchor() {
            Inset::Anchor(Rc::new(node))
        } else {
            Inset::Length(Lp::new(node))
        }
    }

    fn node(&self) -> Option<Node> {
        match self {
            Inset::Auto => None,
            Inset::Length(length) => Some(length.node()),
            Inset::Anchor(node) => Some(Node::clone(node)),
        }
    }
}

impl Css for Inset {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Inset> {
        if keyword(p, "auto") {
            return Some(Inset::Auto);
        }
        computed_length(
            p,
            cx,
            &Options {
                anchor: true,
                anchor_size: true,
                ..Options::LENGTH_PERCENTAGE
            },
            false,
        )
        .map(Inset::new)
    }
    fn write(&self, out: &mut Out) {
        match self.node() {
            Some(node) => node.write(out),
            None => out.extend_from_slice(b"auto"),
        }
    }
    fn lerp(&self, to: &Inset, t: Mixing) -> Option<Inset> {
        match (self, to) {
            (Inset::Length(a), Inset::Length(b)) => a.lerp(b, t).map(Inset::Length),
            _ => Some(Inset::new(self.node()?.lerp(to.node()?, t))),
        }
    }
}

// ───────────────────────────── fonts ─────────────────────────────

/// As `abi::FontDescription::families` has them.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Families(pub(crate) Rc<[u8]>);

impl Families {
    pub(crate) fn names(&self) -> impl Iterator<Item = &[u8]> {
        bun_core::strings::tokenize(&self.0, b"\0")
    }

    pub(crate) fn is_monospace(&self) -> bool {
        *self.0 == *b"\x01monospace\0"
    }
}

impl Css for Families {
    fn parse(p: &mut P, _: &Ctx) -> Option<Families> {
        let mut names = Vec::new();
        for family in commas(p, |p| FontFamily::parse(p).ok())? {
            match family {
                FontFamily::FamilyName(name) => names.extend_from_slice(name),
                FontFamily::Generic(generic) => {
                    names.push(abi::GENERIC_FAMILY);
                    names.extend_from_slice(match generic {
                        GenericFontFamily::Serif => b"serif",
                        GenericFontFamily::SansSerif => b"sans-serif",
                        GenericFontFamily::Cursive => b"cursive",
                        GenericFontFamily::Fantasy => b"fantasy",
                        GenericFontFamily::Monospace => b"monospace",
                        GenericFontFamily::SystemUi => b"system-ui",
                        GenericFontFamily::Emoji => b"emoji",
                        GenericFontFamily::Math => b"math",
                        GenericFontFamily::Fangsong => b"fangsong",
                        GenericFontFamily::UiSerif => b"ui-serif",
                        GenericFontFamily::UiSansSerif => b"ui-sans-serif",
                        GenericFontFamily::UiMonospace => b"ui-monospace",
                        GenericFontFamily::UiRounded => b"ui-rounded",
                    });
                }
            }
            names.push(0);
        }
        Some(Families(names.into()))
    }
    fn write(&self, out: &mut Out) {
        for (index, name) in self.names().enumerate() {
            if index > 0 {
                out.extend_from_slice(b", ");
            }
            match name {
                [abi::GENERIC_FAMILY, generic @ ..] => out.extend_from_slice(generic),
                _ => crate::hooks::write_family(name, out),
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) struct FontSize(
    pub(crate) f32,
    /** Without the minimum. */ pub(crate) f32,
    /** The index of the keyword that it comes from. */ pub(crate) Option<u8>,
);

impl FontSize {
    const OF_KEYWORDS: [[u8; 8]; 8] = [
        [9, 9, 9, 9, 11, 14, 18, 27],
        [9, 9, 9, 10, 12, 15, 20, 30],
        [9, 9, 10, 11, 13, 17, 22, 33],
        [9, 9, 10, 12, 14, 18, 24, 36],
        [9, 10, 12, 13, 16, 20, 26, 39],
        [9, 10, 12, 14, 17, 21, 28, 42],
        [9, 10, 13, 15, 18, 23, 30, 45],
        [9, 10, 13, 16, 18, 24, 32, 48],
    ];
    const OF_KEYWORDS_WITH_QUIRKS: [[u8; 8]; 8] = [
        [9, 9, 9, 9, 11, 14, 18, 28],
        [9, 9, 9, 10, 12, 15, 20, 31],
        [9, 9, 9, 11, 13, 17, 22, 34],
        [9, 9, 10, 12, 14, 18, 24, 37],
        [9, 9, 10, 13, 16, 20, 26, 40],
        [9, 9, 11, 14, 17, 21, 28, 42],
        [9, 10, 12, 15, 17, 23, 30, 45],
        [9, 10, 13, 16, 18, 24, 32, 48],
    ];

    pub(crate) const fn new(size: f32) -> FontSize {
        FontSize(size, size, None)
    }

    pub(crate) const fn medium(size: f32) -> FontSize {
        FontSize(size, size, Some(3))
    }

    pub(crate) fn of_keyword(index: u8, medium: f32, has_quirks: bool, zoom: f32) -> FontSize {
        let row = (if has_quirks {
            &Self::OF_KEYWORDS_WITH_QUIRKS
        } else {
            &Self::OF_KEYWORDS
        })
        .get((medium as usize).wrapping_sub(9));
        let size = zoom
            * row.map_or_else(
                || [0.6, 0.75, 0.89, 1.0, 1.2, 1.5, 2.0, 3.0][usize::from(index)] * medium,
                |it| it[usize::from(index)].into(),
            );
        FontSize(size, size, Some(index))
    }
}

impl Css for FontSize {
    fn parse(p: &mut P, cx: &Ctx) -> Option<FontSize> {
        let parent = || {
            cx.uses(Deps::INHERITED);
            cx.font.size
        };
        if keyword(p, "math") {
            cx.uses(Deps::MATH_FONT_SIZE);
            return Some(FontSize::new(parent()));
        }
        if let Some(name) = ident(p) {
            const NAMES: [&str; 9] = [
                "xx-small",
                "x-small",
                "small",
                "medium",
                "large",
                "x-large",
                "xx-large",
                "xxx-large",
                "-webkit-xxx-large",
            ];
            return Some(match NAMES.iter().position(|it| eq(name, it)) {
                Some(index) => {
                    cx.uses(Deps::FONT_SIZE_KEYWORD);
                    FontSize::of_keyword(index.min(7) as u8, 16.0, false, cx.zoom)
                }
                None if eq(name, "smaller") => FontSize::new((f64::from(parent()) / 1.2) as f32),
                None => FontSize::new(eq(name, "larger").then(|| parent() * 1.2)?),
            });
        }
        let start = p.state();
        let is_calculated = function(p).is_some();
        p.reset(&start);
        let size = Lp::positive(p, cx)?;
        if !matches!(size, Lp::Fraction(_))
            && (is_calculated || !cx.deps.get().contains(Deps::INHERITED))
        {
            cx.uses(Deps::ABSOLUTE_FONT_SIZE);
        }
        Some(FontSize::new(if let Lp::Px(px) = size {
            px
        } else {
            size.resolve(parent()).max(0.0)
        }))
    }
    fn write(&self, out: &mut Out) {
        write_px(self.1, out);
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        Some(FontSize::new(t.of(self.1, to.1).max(0.0)))
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) struct FontWeight(pub(crate) f32);

impl Css for FontWeight {
    fn parse(p: &mut P, cx: &Ctx) -> Option<FontWeight> {
        let Some(name) = ident(p) else {
            return number(p, cx).map(|it| FontWeight(it.clamp(1.0, 1000.0)));
        };
        let relative = |steps: [(f32, f32); 3], otherwise: f32| {
            cx.uses(Deps::INHERITED);
            let step = steps.iter().find(|(below, _)| cx.font.weight < *below);
            step.map_or(otherwise, |(_, weight)| *weight)
        };
        let parent = cx.font.weight;
        Some(FontWeight(match () {
            () if eq(name, "normal") => 400.0,
            () if eq(name, "bold") => 700.0,
            () if eq(name, "bolder") => {
                relative([(350.0, 400.0), (550.0, 700.0), (900.0, 900.0)], parent)
            }
            () if eq(name, "lighter") => {
                relative([(100.0, parent), (550.0, 100.0), (750.0, 400.0)], 700.0)
            }
            () => return None,
        }))
    }
    fn write(&self, out: &mut Out) {
        write_number(self.0, out);
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        Some(FontWeight(t.of(self.0, to.0).clamp(1.0, 1000.0)))
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum FontStyle {
    Normal,
    Italic,
    Oblique(f32),
}

impl FontStyle {
    pub(crate) fn slope(self) -> f32 {
        match self {
            FontStyle::Normal => 0.0,
            FontStyle::Italic => crate::font_face::FontFace::ITALIC,
            FontStyle::Oblique(angle) => angle,
        }
    }
}

impl Css for FontStyle {
    fn parse(p: &mut P, cx: &Ctx) -> Option<FontStyle> {
        Some(match () {
            () if keyword(p, "normal") => FontStyle::Normal,
            () if keyword(p, "italic") => FontStyle::Italic,
            () if keyword(p, "oblique") => FontStyle::slanted(degrees(p, cx).unwrap_or(14.0)),
            () => return None,
        })
    }
    fn write(&self, out: &mut Out) {
        out.extend_from_slice(match self {
            FontStyle::Normal => b"normal",
            FontStyle::Italic => b"italic",
            FontStyle::Oblique(_) => b"oblique",
        });
        if let FontStyle::Oblique(angle) = *self
            && angle != 14.0
        {
            out.push(b' ');
            write_number(angle, out);
            out.extend_from_slice(b"deg");
        }
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        let [a, b] = [self, to].map(|it| match it {
            FontStyle::Normal => Some(0.0),
            FontStyle::Italic => None,
            FontStyle::Oblique(angle) => Some(*angle),
        });
        Some(FontStyle::slanted(t.of(a?, b?)))
    }
}

impl FontStyle {
    fn slanted(degrees: f32) -> FontStyle {
        if degrees == 0.0 {
            FontStyle::Normal
        } else {
            FontStyle::Oblique(degrees.clamp(-90.0, 90.0))
        }
    }
}

/// In percent.
#[derive(Clone, Copy, PartialEq)]
pub(crate) struct FontStretch(pub(crate) f32);

impl FontStretch {
    pub(crate) fn from_css(stretch: CssFontStretch) -> f32 {
        const PERCENT: [f32; 9] = [100.0, 50.0, 62.5, 75.0, 87.5, 112.5, 125.0, 150.0, 200.0];
        match stretch {
            CssFontStretch::Keyword(keyword) => PERCENT[keyword as usize],
            CssFontStretch::Percentage(percentage) => percentage.v * 100.0,
        }
    }
}

impl Css for FontStretch {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        let stretch = attempt(p, |p| CssFontStretch::parse(p).ok())
            .map(|it| FontStretch::from_css(it).max(0.0));
        stretch
            .or_else(|| Some(percentage(p, cx)?.max(0.0) * 100.0))
            .map(FontStretch)
    }
    fn write(&self, out: &mut Out) {
        write_number(self.0, out);
        out.push(b'%');
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        Some(FontStretch(t.of(self.0, to.0).max(0.0)))
    }
}

/// By tag, with only the last for each.
#[derive(Clone, Default, PartialEq)]
pub(crate) struct FontSettings(NormalOrCommas<abi::FontSetting>);

impl core::ops::Deref for FontSettings {
    type Target = [abi::FontSetting];
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Css for FontSettings {
    fn parse(p: &mut P, cx: &Ctx) -> Option<FontSettings> {
        let mut all: Vec<_> = NormalOrCommas::<abi::FontSetting>::parse(p, cx)?
            .iter()
            .rev()
            .copied()
            .collect();
        all.order_by_key(|it| it.tag);
        all.dedup_by_key(|it| it.tag);
        Some(FontSettings(NormalOrCommas(all.into())))
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        self.0.lerp(&to.0, t).map(FontSettings)
    }
}

impl Css for abi::FontSetting {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        let tag = string(p)?.try_into().ok()?;
        let value = match () {
            () if keyword(p, "off") => 0.0,
            () if keyword(p, "on") => 1.0,
            () => number(p, cx).unwrap_or(1.0),
        };
        Some(abi::FontSetting { tag, value })
    }
    fn write(&self, out: &mut Out) {
        write_string(&self.tag, out);
        out.push(b' ');
        write_number(self.value, out);
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        (self.tag == to.tag).then(|| abi::FontSetting {
            tag: self.tag,
            value: t.of(self.value, to.value),
        })
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum LineHeight {
    Normal,
    Number(f32),
    Px(f32),
}

impl Css for LineHeight {
    fn parse(p: &mut P, cx: &Ctx) -> Option<LineHeight> {
        if keyword(p, "normal") {
            return Some(LineHeight::Normal);
        }
        if let Some(number) = quantity(p, cx, Kind::Number, 0.0) {
            return Some(LineHeight::Number(number));
        }
        Some(LineHeight::Px(match Lp::positive(p, cx)? {
            Lp::Px(px) => px,
            relative => {
                cx.uses(Deps::INHERITED);
                relative.resolve(cx.font.size)
            }
        }))
    }
    fn write(&self, out: &mut Out) {
        match self {
            LineHeight::Normal => out.extend_from_slice(b"normal"),
            LineHeight::Number(number) => write_number(*number, out),
            LineHeight::Px(px) => write_px(*px, out),
        }
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        match (self, to) {
            (Self::Number(a), Self::Number(b)) => Some(Self::Number(t.of(*a, *b).max(0.0))),
            (Self::Px(a), Self::Px(b)) => Some(Self::Px(t.of(*a, *b).max(0.0))),
            _ => None,
        }
    }
}

/// `letter-spacing` or `word-spacing`.
#[derive(Clone, PartialEq)]
pub(crate) struct Spacing(pub(crate) Lp);

impl Css for Spacing {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Spacing> {
        match keyword(p, "normal") {
            true => Some(Spacing(Lp::ZERO)),
            false => Lp::parse(p, cx).map(Spacing),
        }
    }
    fn write(&self, out: &mut Out) {
        match &self.0 {
            Lp::Px(0.0) => out.extend_from_slice(b"normal"),
            length => length.write(out),
        }
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        self.0.lerp(&to.0, t).map(Spacing)
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum TabSize {
    Spaces(f32),
    Px(f32),
}

#[derive(Clone, Copy, Default, PartialEq)]
pub(crate) struct FlexWrap {
    pub(crate) wraps: bool,
    pub(crate) is_reversed: bool,
    pub(crate) is_balanced: bool,
}

impl Css for FlexWrap {
    fn parse(p: &mut P, _: &Ctx) -> Option<FlexWrap> {
        if keyword(p, "nowrap") {
            return Some(FlexWrap::default());
        }
        let is_balanced = keyword(p, "balance");
        let is_reversed = keyword(p, "wrap-reverse");
        let has_direction = is_reversed || keyword(p, "wrap");
        (is_balanced || has_direction).then(|| FlexWrap {
            wraps: true,
            is_reversed,
            is_balanced: is_balanced || keyword(p, "balance"),
        })
    }
    fn write(&self, out: &mut Out) {
        out.extend_from_slice(match (self.wraps, self.is_reversed, self.is_balanced) {
            (false, ..) => b"nowrap",
            (_, false, false) => b"wrap",
            (_, false, true) => b"balance",
            (_, true, false) => b"wrap-reverse",
            (_, true, true) => b"wrap-reverse balance",
        });
    }
}

/// At least 1.
#[derive(Clone, Copy, PartialEq)]
pub(crate) struct Count(pub(crate) i32);

impl Css for Count {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Count> {
        match attempt(p, |p| p.expect_integer().ok()) {
            Some(literal) => (literal >= 1).then_some(Count(literal)),
            None => Some(Count(integer(p, cx)?.max(1))),
        }
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
    }
    fn lerp(&self, to: &Count, t: Mixing) -> Option<Count> {
        self.0.lerp(&to.0, t).map(|it| Count(it.max(1)))
    }
}

impl Css for TabSize {
    fn parse(p: &mut P, cx: &Ctx) -> Option<TabSize> {
        quantity(p, cx, Kind::Number, 0.0)
            .map(TabSize::Spaces)
            .or_else(|| quantity(p, cx, Kind::Length, 0.0).map(TabSize::Px))
    }
    fn write(&self, out: &mut Out) {
        match self {
            TabSize::Spaces(count) => write_number(*count, out),
            TabSize::Px(px) => write_px(*px, out),
        }
    }
}

#[derive(Clone, PartialEq)]
pub(crate) struct Thickness(pub(crate) Option<Lp>, pub(crate) bool);

impl Css for Thickness {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        let is_from_font = keyword(p, "from-font");
        match is_from_font || keyword(p, "auto") {
            true => Some(Thickness(None, is_from_font)),
            false => Lp::parse(p, cx).map(|length| Thickness(Some(length), false)),
        }
    }
    fn write(&self, out: &mut Out) {
        if self.1 {
            out.extend(b"from-font")
        } else {
            Auto(self.0.clone()).write(out)
        }
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        Some(Thickness(
            Some(self.0.as_ref()?.lerp(to.0.as_ref()?, t)?),
            false,
        ))
    }
}

// ───────────────────────────── images ─────────────────────────────

#[derive(Clone, PartialEq)]
pub(crate) enum GradientKind {
    Angle(f32),
    /// The signs of the corner's direction.
    Corner(f32, f32),
    Circle(Result<f32, Extent>, Position),
    Ellipse(Result<[Lp; 2], Extent>, Position),
    Conic(f32, Position),
    /// `-webkit-gradient()`, with the radii.
    Points([Position; 2], Option<[f32; 2]>),
}

#[derive(Clone, PartialEq)]
pub(crate) struct Stop {
    /// `None` for a hint.
    pub(crate) color: Option<Color>,
    pub(crate) position: Option<Lp>,
}

#[derive(Clone, PartialEq)]
pub(crate) struct Gradient {
    pub(crate) kind: GradientKind,
    pub(crate) stops: Vec<Stop>,
    pub(crate) repeating: bool,
    pub(crate) interpolation: Interpolation,
    source: Str,
}

fn linear_direction(p: &mut P, cx: &Ctx, legacy: bool) -> Option<GradientKind> {
    if let Some(angle) = degrees(p, cx) {
        return Some(GradientKind::Angle(if legacy {
            90.0 - angle
        } else {
            angle
        }));
    }
    if !legacy && !keyword(p, "to") {
        return None;
    }
    let (mut x, mut y) = (0.0, 0.0);
    let sign = if legacy { -1.0 } else { 1.0 };
    loop {
        match () {
            () if keyword(p, "left") => x = -sign,
            () if keyword(p, "right") => x = sign,
            () if keyword(p, "top") => y = -sign,
            () if keyword(p, "bottom") => y = sign,
            () => break,
        }
    }
    Some(match (x, y) {
        (0.0, 0.0) => return None,
        (0.0, y) => GradientKind::Angle(if y < 0.0 { 0.0 } else { 180.0 }),
        (x, 0.0) => GradientKind::Angle(if x < 0.0 { 270.0 } else { 90.0 }),
        (x, y) => GradientKind::Corner(x, y),
    })
}

fn at_position(p: &mut P, cx: &Ctx) -> Option<Position> {
    match keyword(p, "at") {
        true => Position::parse(p, cx),
        false => Some(Position::CENTER),
    }
}

fn radial_shape(p: &mut P, cx: &Ctx) -> Option<GradientKind> {
    let (mut circle, mut extent, mut radii) = (None, None, Vec::new());
    loop {
        if keyword(p, "circle") {
            circle = Some(true);
        } else if keyword(p, "ellipse") {
            circle = Some(false);
        } else if let Some(keyword) = Extent::parse(p, cx) {
            extent = Some(keyword);
        } else if let Some(radius) = Lp::positive(p, cx) {
            radii.push(radius);
        } else {
            break;
        }
    }
    let center = at_position(p, cx)?;
    let extent = extent.unwrap_or(Extent::FarthestCorner);
    Some(match (circle, &radii[..]) {
        (Some(true), []) => GradientKind::Circle(Err(extent), center),
        (_, []) => GradientKind::Ellipse(Err(extent), center),
        (None | Some(true), [Lp::Px(radius)]) => GradientKind::Circle(Ok(*radius), center),
        (None | Some(false), [x, y]) => GradientKind::Ellipse(Ok([x.clone(), y.clone()]), center),
        _ => return None,
    })
}

impl Gradient {
    fn solid(color: Color) -> Gradient {
        let stops = vec![
            Stop {
                color: Some(color),
                position: None
            };
            2
        ];
        Gradient {
            kind: GradientKind::Angle(0.0),
            stops,
            repeating: false,
            interpolation: Interpolation::SRGB,
            source: "".into(),
        }
    }

    fn oldest(p: &mut P, cx: &Ctx) -> Option<Gradient> {
        let is_radial = !keyword(p, "linear") && keyword(p, "radial");
        let length = |p: &mut P| crate::svg_values::SvgLength::parse(p, cx).map(|it| it.0);
        let mut end = || {
            let point = comma(p).then(|| {
                attempt(p, |p| Some(Position(length(p)?, length(p)?)))
                    .or_else(|| Position::parse(p, cx))
            })??;
            Some((
                point,
                if is_radial && comma(p) {
                    number(p, cx)? * cx.zoom
                } else {
                    0.0
                },
            ))
        };
        let (from, to, mut stops) = (end()?, end()?, Vec::new());
        while comma(p) {
            let name = function(p)?;
            stops.push(nested(p, |p| {
                let at = if eq(name, "color-stop") {
                    Alpha::parse(p, cx).filter(|_| comma(p))?.0
                } else {
                    f32::from(eq(name, "to"))
                };
                Some((at, Color::parse(p, cx)?))
            })?);
        }
        stops.order_by(|a, b| a.0.total_cmp(&b.0));
        let stops = stops
            .into_iter()
            .map(|(at, color)| Stop {
                color: Some(color),
                position: Some(Lp::Fraction(at)),
            })
            .collect();
        Some(Gradient {
            kind: GradientKind::Points([from.0, to.0], is_radial.then_some([from.1, to.1])),
            stops,
            ..Gradient::solid(Color::Current)
        })
    }

    fn parse(name: &[u8], p: &mut P, cx: &Ctx) -> Option<Gradient> {
        let unprefixed = name.strip_prefix(b"-webkit-");
        let plain = unprefixed.unwrap_or(name);
        let unrepeated = plain.strip_prefix(b"repeating-");
        let plain = unrepeated.unwrap_or(plain);
        let start = p.position();
        let before = Interpolation::parse(p);
        let conic = eq(plain, "conic-gradient");
        let kind = match () {
            () if eq(plain, "linear-gradient") => {
                attempt(p, |p| linear_direction(p, cx, unprefixed.is_some()))
                    .unwrap_or(GradientKind::Angle(180.0))
            }
            () if eq(plain, "radial-gradient") => radial_shape(p, cx)?,
            () if conic => {
                let angle = match keyword(p, "from") {
                    true => degrees(p, cx)?,
                    false => 0.0,
                };
                GradientKind::Conic(angle, at_position(p, cx)?)
            }
            () => return None,
        };
        let interpolation = before.or_else(|| Interpolation::parse(p));
        comma(p);
        let position = |p: &mut P| match conic {
            false => Lp::parse(p, cx),
            true => (Node::parse(
                p,
                &Options {
                    percentages: true,
                    ..Options::new(Kind::Angle)
                },
            )
            .map(|it| it.compute(cx, 360.0) as f32))
            .or_else(|| degrees(p, cx))
            .map(|angle| Lp::Fraction(angle / 360.0)),
        };
        let mut stops = Vec::new();
        loop {
            let color = Color::parse(p, cx);
            let first = position(p);
            if color.is_none() && first.is_none() {
                return None;
            }
            let second = color.and(first.as_ref()).and_then(|_| position(p));
            stops.push(Stop {
                color,
                position: first,
            });
            if second.is_some() {
                stops.push(Stop {
                    color,
                    position: second,
                });
            }
            if !comma(p) {
                break;
            }
        }
        (stops.first()?.color.is_some() && stops.last()?.color.is_some()).then_some(())?;
        let is_legacy = stops.iter().all(|it| {
            it.color
                .is_none_or(|it| matches!(it, Color::Current | Color::Rgba(_)))
        });
        Some(Gradient {
            kind,
            stops,
            repeating: unrepeated.is_some(),
            interpolation: interpolation.unwrap_or(if is_legacy {
                Interpolation::SRGB
            } else {
                Interpolation::OKLAB
            }),
            source: format!("{}({})", text(name), text(p.slice_from(start).trim_ascii())).into(),
        })
    }
}

#[derive(Clone, PartialEq)]
pub(crate) enum Image {
    Url(Str),
    Gradient(Rc<Gradient>),
    /// With their resolutions, which ascend.
    Set(Rc<[(Image, f32)]>),
    /// With the share of the second.
    Fade(Rc<([Option<Image>; 2], f32)>),
}

impl Image {
    /// With its resolution, for a screen that has this one.
    pub(crate) fn chosen(&self, scale: f32) -> Option<(&Image, f32)> {
        let Image::Set(options) = self else {
            return Some((self, 1.0));
        };
        options
            .iter()
            .find(|it| it.1 >= scale)
            .or_else(|| options.last())
            .map(|it| (&it.0, it.1))
    }

    fn set(p: &mut P, cx: &Ctx) -> Option<Image> {
        const TYPES: [&str; 8] = [
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "image/svg+xml",
            "image/bmp",
            "image/x-icon",
            "image/apng",
        ];
        let options = commas(p, |p| {
            let image = string(p)
                .map(|url| Image::Url(cx.url(url)))
                .or_else(|| Image::parse(p, cx))?;
            let kind =
                |p: &mut P| function(p).and_then(|_| nested(p, |p| string(p).map(<[u8]>::to_vec)));
            let (before, resolution) = (
                attempt(p, |p| kind(p).filter(|it| !it.is_empty())),
                quantity(p, cx, Kind::Resolution, 0.0).unwrap_or(1.0),
            );
            let kind = before.or_else(|| kind(p));
            Some((
                image,
                resolution,
                kind.is_none_or(|it| TYPES.iter().any(|known| eq(&it, known))),
            ))
        });
        let mut options: Vec<_> = options?
            .into_iter()
            .filter(|it| it.2 && it.1 > 0.0)
            .map(|it| (it.0, it.1))
            .collect();
        options.order_by(|a, b| a.1.total_cmp(&b.1));
        options.dedup_by(|a, b| a.1 == b.1);
        Some(Image::Set(options.into()))
    }
}

impl Css for Image {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Image> {
        if let Some((url, modifiers)) = link(p) {
            return Some(Image::Url(request(url, modifiers, cx)));
        }
        attempt(p, |p| {
            let name = function(p)?;
            let pair = |p: &mut P| {
                Some([
                    NoneOr::parse(p, cx).filter(|_| comma(p))?.0,
                    NoneOr::parse(p, cx)?.0,
                ])
            };
            nested(p, |p| match () {
                () if eq(name, "image-set") || eq(name, "-webkit-image-set") => Image::set(p, cx),
                () if eq(name, "-webkit-cross-fade") => Some(Image::Fade(Rc::new((
                    pair(p).filter(|_| comma(p))?,
                    Alpha::parse(p, cx)?.0,
                )))),
                () if eq(name, "light-dark") => {
                    let [light, dark] = pair(p)?;
                    cx.uses(Deps::INHERITED);
                    Some(
                        (if cx.dark { dark } else { light })
                            .unwrap_or_else(|| Image::Set(Rc::new([]))),
                    )
                }
                () if eq(name, "image") => Some(Image::Gradient(Rc::new(Gradient::solid(
                    Color::parse(p, cx)?,
                )))),
                () if eq(name, "-webkit-gradient") => {
                    Some(Image::Gradient(Rc::new(Gradient::oldest(p, cx)?)))
                }
                () => Some(Image::Gradient(Rc::new(Gradient::parse(name, p, cx)?))),
            })
        })
    }
    fn write(&self, out: &mut Out) {
        match self {
            Image::Url(url) => write_url(url, out),
            Image::Gradient(gradient) => out.extend_from_slice(gradient.source.as_bytes()),
            Image::Set(_) | Image::Fade(_) => {}
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) struct ClipArea(pub(crate) BoxArea);

impl Css for ClipArea {
    fn parse(p: &mut P, cx: &Ctx) -> Option<ClipArea> {
        let first = BoxArea::parse(p, cx)?;
        let is_both = first == BoxArea::BorderArea && keyword(p, "text")
            || first == BoxArea::Text && keyword(p, "border-area");
        Some(ClipArea(if is_both {
            BoxArea::BorderAreaAndText
        } else {
            first
        }))
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
    }
}

#[derive(Clone, PartialEq)]
pub(crate) enum BackgroundSize {
    Cover,
    Contain,
    Explicit(Auto<PositiveLp>, Auto<PositiveLp>),
}

impl BackgroundSize {
    pub(crate) const AUTO: BackgroundSize = BackgroundSize::Explicit(Auto(None), Auto(None));
}

impl Css for BackgroundSize {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        Some(match () {
            () if keyword(p, "cover") => BackgroundSize::Cover,
            () if keyword(p, "contain") => BackgroundSize::Contain,
            () => BackgroundSize::Explicit(
                Auto::parse(p, cx)?,
                Auto::parse(p, cx).unwrap_or(Auto(None)),
            ),
        })
    }
    fn write(&self, out: &mut Out) {
        match self {
            BackgroundSize::Cover => out.extend_from_slice(b"cover"),
            BackgroundSize::Contain => out.extend_from_slice(b"contain"),
            BackgroundSize::Explicit(width, height) => {
                width.write(out);
                if *self != BackgroundSize::AUTO {
                    out.push(b' ');
                    height.write(out);
                }
            }
        }
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        let (Self::Explicit(a, b), Self::Explicit(c, d)) = (self, to) else {
            return (self == to).then(|| to.clone());
        };
        let axis = |from: &Auto<PositiveLp>, to: &Auto<_>| match from.0.is_none() && to.0.is_none()
        {
            true => Some(from.clone()),
            false => from.lerp(to, t),
        };
        Some(Self::Explicit(axis(a, c)?, axis(b, d)?))
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Repeat(pub(crate) RepeatKind, pub(crate) RepeatKind);

impl Css for Repeat {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Repeat> {
        Some(match () {
            () if keyword(p, "repeat-x") => Repeat(RepeatKind::Repeat, RepeatKind::NoRepeat),
            () if keyword(p, "repeat-y") => Repeat(RepeatKind::NoRepeat, RepeatKind::Repeat),
            () => {
                let Pair(x, y) = Pair::parse(p, cx)?;
                Repeat(x, y)
            }
        })
    }
    fn write(&self, out: &mut Out) {
        match (self.0, self.1) {
            (RepeatKind::Repeat, RepeatKind::NoRepeat) => out.extend_from_slice(b"repeat-x"),
            (RepeatKind::NoRepeat, RepeatKind::Repeat) => out.extend_from_slice(b"repeat-y"),
            (x, y) => Pair(x, y).write(out),
        }
    }
}

// ───────────────────────────── shadows and filters ─────────────────────────────

#[derive(Clone, Copy, PartialEq)]
pub(crate) struct Shadow {
    pub(crate) color: Color,
    pub(crate) offset: [f32; 2],
    pub(crate) blur: f32,
    pub(crate) spread: f32,
    pub(crate) inset: bool,
}

impl Css for Shadow {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Shadow> {
        let (mut color, mut lengths, mut inset) = (None, None, false);
        loop {
            if !inset && keyword(p, "inset") {
                inset = true;
            } else if lengths.is_none()
                && let Some(x) = px(p, cx)
            {
                let y = px(p, cx)?;
                let blur = px(p, cx).unwrap_or(0.0);
                lengths = Some(([x, y], blur, px(p, cx).unwrap_or(0.0)));
            } else if color.is_none()
                && let Some(parsed) = Color::parse(p, cx)
            {
                color = Some(parsed);
            } else {
                break;
            }
        }
        let (offset, blur, spread) = lengths.filter(|lengths| lengths.1 >= 0.0)?;
        Some(Shadow {
            color: color.unwrap_or(Color::Current),
            offset,
            blur,
            spread,
            inset,
        })
    }
    fn write(&self, out: &mut Out) {
        self.color.write(out);
        for length in [self.offset[0], self.offset[1], self.blur, self.spread] {
            out.push(b' ');
            write_px(length, out);
        }
        if self.inset {
            out.extend_from_slice(b" inset");
        }
    }
    fn lerp(&self, to: &Shadow, t: Mixing) -> Option<Shadow> {
        (self.inset == to.inset).then_some(())?;
        Some(Shadow {
            color: self.color.lerp(&to.color, t)?,
            offset: [0, 1].map(|axis| t.of(self.offset[axis], to.offset[axis])),
            blur: t.of(self.blur, to.blur).max(0.0),
            spread: t.of(self.spread, to.spread),
            inset: self.inset,
        })
    }
}

/// Interpolates two lists after padding the shorter one with `neutral` items.
fn lerp_padded<T: Css>(from: &[T], to: &[T], t: Mixing, neutral: fn(&T) -> T) -> Option<Rc<[T]>> {
    if t == Mixing::Add {
        return Some(from.iter().chain(to).cloned().collect());
    }
    (0..from.len().max(to.len()))
        .map(|index| match (from.get(index), to.get(index)) {
            (Some(a), Some(b)) => a.lerp(b, t),
            (Some(a), None) => a.lerp(&neutral(a), t),
            (None, Some(b)) => neutral(b).lerp(b, t),
            (None, None) => None,
        })
        .collect()
}

#[derive(Clone, Default, PartialEq)]
pub(crate) struct Shadows(pub(crate) NoneOrCommas<Shadow>);

impl Css for Shadows {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        NoneOrCommas::parse(p, cx)
            .filter(|it| it.len() <= 1024)
            .map(Shadows)
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        let neutral = |shadow: &Shadow| Shadow {
            color: Color::TRANSPARENT,
            offset: [0.0; 2],
            blur: 0.0,
            spread: 0.0,
            inset: shadow.inset,
        };
        lerp_padded(&self.0, &to.0, t, neutral).map(|list| Shadows(NoneOrCommas(list)))
    }
}

#[derive(Clone, Default, PartialEq)]
pub(crate) struct TextShadows(pub(crate) Shadows);

impl Css for TextShadows {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        Shadows::parse(p, cx).map(TextShadows)
    }
    fn write(&self, out: &mut Out) {
        if self.0.0.is_empty() {
            return self.0.write(out);
        }
        write_list(&self.0.0, ", ", out, |it, out| {
            it.write(out);
            out.truncate(bun_core::strings::last_index_of_char(out, b' ').unwrap_or(0));
        });
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        self.0.lerp(&to.0, t).map(TextShadows)
    }
}

keywords! {
    FilterName { Blur = "blur", Brightness = "brightness", Contrast = "contrast", Grayscale = "grayscale",
        HueRotate = "hue-rotate", Invert = "invert", Opacity = "opacity", Saturate = "saturate", Sepia = "sepia" }
}

impl FilterName {
    fn clamp(self, amount: f32) -> f32 {
        match self {
            FilterName::HueRotate => amount,
            FilterName::Grayscale
            | FilterName::Invert
            | FilterName::Opacity
            | FilterName::Sepia => amount.clamp(0.0, 1.0),
            _ => amount.max(0.0),
        }
    }
}

#[derive(Clone, PartialEq)]
pub(crate) enum Filter {
    Amount(FilterName, f32),
    DropShadow(Shadow),
    Url(Str),
}

impl Filter {
    /// `None` for a URL.
    pub(crate) fn function(&self, scale: f32, current_color: u32) -> Option<abi::Filter> {
        Some(match self {
            Filter::Url(_) => return None,
            Filter::DropShadow(it) => abi::Filter::DropShadow {
                offset: it.offset.map(|it| it * scale),
                blur: it.blur * scale,
                color: it.color.resolve(current_color),
            },
            Filter::Amount(FilterName::Blur, radius) => abi::Filter::Blur(radius * scale),
            Filter::Amount(name, amount) => (match name {
                FilterName::Blur => abi::Filter::Blur,
                FilterName::Brightness => abi::Filter::Brightness,
                FilterName::Contrast => abi::Filter::Contrast,
                FilterName::Grayscale => abi::Filter::Grayscale,
                FilterName::HueRotate => abi::Filter::HueRotate,
                FilterName::Invert => abi::Filter::Invert,
                FilterName::Opacity => abi::Filter::Opacity,
                FilterName::Saturate => abi::Filter::Saturate,
                FilterName::Sepia => abi::Filter::Sepia,
            })(*amount),
        })
    }

    fn neutral(&self) -> Filter {
        use FilterName as F;
        match self {
            Filter::Amount(name, _) => Filter::Amount(
                *name,
                match name {
                    F::Brightness | F::Contrast | F::Opacity | F::Saturate => 1.0,
                    _ => 0.0,
                },
            ),
            Filter::DropShadow(shadow) => Filter::DropShadow(Shadow {
                color: Color::TRANSPARENT,
                offset: [0.0; 2],
                blur: 0.0,
                ..*shadow
            }),
            Filter::Url(_) => self.clone(),
        }
    }
}

impl Css for Filter {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Filter> {
        if let Some(url) = url(p, cx) {
            return Some(Filter::Url(url));
        }
        let name = function(p)?;
        if eq(name, "drop-shadow") {
            return nested(p, |p| Shadow::parse(p, cx)).map(Filter::DropShadow);
        }
        let name = FilterName::from_name(name)?;
        let amount = nested(p, |p| match name {
            FilterName::Blur => Some(px(p, cx).unwrap_or(0.0).max(0.0)),
            FilterName::HueRotate => Some(degrees(p, cx).unwrap_or(0.0)),
            _ => Some(number_or_percentage(p, cx).unwrap_or(1.0).max(0.0)),
        })?;
        Some(Filter::Amount(name, name.clamp(amount)))
    }
    fn write(&self, out: &mut Out) {
        match self {
            Filter::Url(url) => return write_url(url, out),
            Filter::DropShadow(shadow) => {
                out.extend_from_slice(b"drop-shadow(");
                shadow.color.write(out);
                for length in [shadow.offset[0], shadow.offset[1], shadow.blur] {
                    out.push(b' ');
                    write_px(length, out);
                }
            }
            Filter::Amount(name, amount) => {
                name.write(out);
                out.push(b'(');
                write_number(
                    if *name == FilterName::Blur {
                        amount / crate::values::written_zoom()
                    } else {
                        *amount
                    },
                    out,
                );
                out.extend_from_slice(match name {
                    FilterName::Blur => b"px",
                    FilterName::HueRotate => b"deg",
                    _ => b"",
                });
            }
        }
        out.push(b')');
    }
    fn lerp(&self, to: &Filter, t: Mixing) -> Option<Filter> {
        match (self, to) {
            (Filter::Amount(a, from), Filter::Amount(b, to)) if a == b => {
                let amount = if self.neutral() == Filter::Amount(*a, 1.0) {
                    t.of_factors(*from, *to)
                } else {
                    t.of(*from, *to)
                };
                Some(Filter::Amount(
                    *a,
                    if let Mixing::Lerp(_) = t {
                        a.clamp(amount)
                    } else {
                        amount
                    },
                ))
            }
            (Filter::DropShadow(a), Filter::DropShadow(b)) => a.lerp(b, t).map(Filter::DropShadow),
            _ => None,
        }
    }
}

#[derive(Clone, Default, PartialEq)]
pub(crate) struct Filters(pub(crate) NoneOrSpaces<Filter>);

impl Css for Filters {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        NoneOrSpaces::parse(p, cx).map(Filters)
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
    }
    fn lerp(&self, to: &Self, t: Mixing) -> Option<Self> {
        lerp_padded(&self.0, &to.0, t, Filter::neutral).map(|list| Filters(NoneOrSpaces(list)))
    }
}

// ───────────────────────────── transforms ─────────────────────────────

pub(crate) const IDENTITY: abi::Matrix = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

/// `b` is applied first.
pub(crate) fn multiply(a: &abi::Matrix, b: &abi::Matrix) -> abi::Matrix {
    [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5],
    ]
}

pub(crate) fn invert(m: &abi::Matrix) -> Option<abi::Matrix> {
    let determinant = m[0] * m[3] - m[1] * m[2];
    (determinant != 0.0 && determinant.is_finite()).then(|| {
        [
            m[3] / determinant,
            -m[1] / determinant,
            -m[2] / determinant,
            m[0] / determinant,
            (m[2] * m[5] - m[3] * m[4]) / determinant,
            (m[1] * m[4] - m[0] * m[5]) / determinant,
        ]
    })
}

pub(crate) fn apply(m: &abi::Matrix, [x, y]: [f32; 2]) -> [f32; 2] {
    [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

// ───────────────────────────── clipping ─────────────────────────────

pub(crate) type Corner = Pair<PositiveLp>;

pub(crate) fn corners(p: &mut P, cx: &Ctx) -> Option<[Corner; 4]> {
    let horizontal = sides::<PositiveLp>(p, cx)?;
    let vertical = match delim(p, b'/') {
        true => sides(p, cx)?,
        false => horizontal.clone(),
    };
    let mut pairs = horizontal.into_iter().zip(vertical);
    Some(core::array::from_fn(|_| {
        let (x, y) = pairs.next().expect("four corners");
        Pair(x, y)
    }))
}

#[derive(Clone, PartialEq)]
pub(crate) enum Shape {
    Box,
    Inset([Lp; 4], Option<[Corner; 4]>),
    Ellipse([Result<Lp, Extent>; 2], Position, bool),
    /// With the radius of the corners.
    Polygon(FillRule, Vec<Position>, f32),
    Commands(FillRule, crate::shapes::Commands),
    Path(FillRule, Str),
    Url(Str),
    Image(Image),
}

#[derive(Clone, PartialEq)]
pub(crate) struct ClipPath(pub(crate) Option<Rc<(Shape, BoxArea)>>);

#[derive(Clone, PartialEq)]
pub(crate) struct ShapeOutside(pub(crate) ClipPath);

impl Css for ShapeOutside {
    fn parse(p: &mut P, cx: &Ctx) -> Option<ShapeOutside> {
        let image = Image::parse(p, cx)
            .map(|it| ClipPath(Some(Rc::new((Shape::Image(it), BoxArea::MarginBox)))));
        image
            .or_else(|| ClipPath::with_default(p, cx, BoxArea::MarginBox))
            .map(ShapeOutside)
    }
    fn write(&self, out: &mut Out) {
        self.0.write(out);
        if let Some((_, area)) = self
            .0
            .0
            .as_deref()
            .filter(|it| it.0 != Shape::Box && it.1 != BoxArea::MarginBox)
        {
            out.push(b' ');
            area.write(out);
        }
    }
    fn lerp(&self, to: &ShapeOutside, t: Mixing) -> Option<ShapeOutside> {
        self.0.lerp(&to.0, t).map(ShapeOutside)
    }
}

/// At the start and at the end.
#[derive(Clone, Copy, PartialEq)]
pub(crate) struct MarginTrim(pub(crate) [bool; 2]);

impl Css for MarginTrim {
    fn parse(p: &mut P, _: &Ctx) -> Option<MarginTrim> {
        Some(MarginTrim(match () {
            () if keyword(p, "none") => [false; 2],
            () if keyword(p, "block") => [true; 2],
            () if keyword(p, "block-start") => [true, keyword(p, "block-end")],
            () if keyword(p, "block-end") => [keyword(p, "block-start"), true],
            () => return None,
        }))
    }
    fn write(&self, out: &mut Out) {
        out.extend_from_slice(
            [["none", "block-end"], ["block-start", "block"]][usize::from(self.0[0])]
                [usize::from(self.0[1])]
            .as_bytes(),
        );
    }
}

pub(crate) fn shape(name: &[u8], p: &mut P, cx: &Ctx) -> Option<Shape> {
    let round = |p: &mut P| match keyword(p, "round") {
        true => corners(p, cx).map(Some),
        false => Some(None),
    };
    let radius = |p: &mut P| {
        (Lp::positive(p, cx).map(Ok))
            .or_else(|| Extent::parse(p, cx).map(Err))
            .unwrap_or(Err(Extent::ClosestSide))
    };
    let fill_rule = |p: &mut P| {
        let rule = FillRule::parse(p, cx);
        comma(p);
        rule.unwrap_or(FillRule::Nonzero)
    };
    Some(match () {
        () if eq(name, "inset") => Shape::Inset(sides(p, cx)?, round(p)?),
        () if eq(name, "rect") => {
            let [top, right, bottom, left] = sides::<Auto<Lp>>(p, cx)?;
            let start = |edge: Auto<Lp>| edge.0.unwrap_or(Lp::ZERO);
            let end = |edge: Auto<Lp>| edge.0.map_or(Lp::ZERO, |edge| edge.from_end());
            Shape::Inset(
                [start(top), end(right), end(bottom), start(left)],
                round(p)?,
            )
        }
        () if eq(name, "xywh") => {
            let [x, y] = [Lp::parse(p, cx)?, Lp::parse(p, cx)?];
            let [right, bottom] = [Lp::positive(p, cx)?.plus(&x), Lp::positive(p, cx)?.plus(&y)];
            Shape::Inset([y, right.from_end(), bottom.from_end(), x], round(p)?)
        }
        () if eq(name, "circle") => {
            let radius = radius(p);
            Shape::Ellipse([radius.clone(), radius], at_position(p, cx)?, true)
        }
        () if eq(name, "ellipse") => {
            Shape::Ellipse([radius(p), radius(p)], at_position(p, cx)?, false)
        }
        () if eq(name, "polygon") => {
            let (rule, radius) = (
                fill_rule(p),
                if keyword(p, "round") {
                    Px::parse(p, cx)?.0
                } else {
                    0.0
                },
            );
            comma(p);
            Shape::Polygon(
                rule,
                commas(p, |p| Some(Position(Lp::parse(p, cx)?, Lp::parse(p, cx)?)))?,
                radius,
            )
        }
        () if eq(name, "shape") => {
            Shape::Commands(fill_rule(p), crate::shapes::Commands::parse(p, cx)?)
        }
        () if eq(name, "path") => Shape::Path(fill_rule(p), text(string(p)?).into()),
        () => return None,
    })
}

impl ClipPath {
    fn with_default(p: &mut P, cx: &Ctx, default: BoxArea) -> Option<ClipPath> {
        if keyword(p, "none") {
            return Some(ClipPath(None));
        }
        if let Some(url) = url(p, cx) {
            return Some(ClipPath(Some(Rc::new((
                Shape::Url(url),
                BoxArea::BorderBox,
            )))));
        }
        let before = BoxArea::parse(p, cx);
        let shape = match function(p) {
            Some(name) => nested(p, |p| shape(name, p, cx))?,
            None => before.map(|_| Shape::Box)?,
        };
        let area = before.or_else(|| BoxArea::parse(p, cx));
        Some(ClipPath(Some(Rc::new((shape, area.unwrap_or(default))))))
    }
}

impl Css for ClipPath {
    fn parse(p: &mut P, cx: &Ctx) -> Option<ClipPath> {
        ClipPath::with_default(p, cx, BoxArea::BorderBox)
    }
    fn write(&self, out: &mut Out) {
        let Some((shape, area)) = self.0.as_deref() else {
            return out.extend_from_slice(b"none");
        };
        match shape {
            Shape::Box => return area.write(out),
            Shape::Url(url) => return write_url(url, out),
            Shape::Image(image) => return image.write(out),
            Shape::Inset(edges, _) => {
                out.extend_from_slice(b"inset(");
                write_list(edges, " ", out, Lp::write);
            }
            Shape::Ellipse(radii, center, circle) => {
                out.extend_from_slice(if *circle { b"circle(" } else { b"ellipse(" });
                let count = if *circle { 1 } else { 2 };
                write_list(&radii[..count], " ", out, |radius, out| match radius {
                    Ok(length) => length.write(out),
                    Err(extent) => extent.write(out),
                });
                out.extend_from_slice(b" at ");
                center.write(out);
            }
            Shape::Commands(..) => {}
            Shape::Polygon(_, points, _) => {
                out.extend_from_slice(b"polygon(");
                write_list(points, ", ", out, Position::write);
            }
            Shape::Path(_, path) => {
                out.extend_from_slice(b"path(");
                write_string(path.as_bytes(), out);
            }
        }
        out.push(b')');
    }
    fn lerp(&self, to: &ClipPath, t: Mixing) -> Option<ClipPath> {
        fn each<T: Css, const N: usize>(a: &[T; N], b: &[T; N], t: Mixing) -> Option<[T; N]> {
            let items: Option<Vec<T>> = a.iter().zip(b).map(|(a, b)| a.lerp(b, t)).collect();
            items?.try_into().ok()
        }
        let ((from, area), (to, other)) = (self.0.as_deref()?, to.0.as_deref()?);
        (area == other).then_some(())?;
        let shape = match (from, to) {
            (Shape::Inset(a, from_radii), Shape::Inset(b, to_radii)) => {
                let square =
                    || core::array::from_fn(|_| Pair(PositiveLp(Lp::ZERO), PositiveLp(Lp::ZERO)));
                let (from_radii, to_radii) = (from_radii.clone(), to_radii.clone());
                let radii = each(
                    &from_radii.unwrap_or_else(square),
                    &to_radii.unwrap_or_else(square),
                    t,
                );
                Shape::Inset(each(a, b, t)?, radii)
            }
            (
                Shape::Ellipse([Ok(a), Ok(b)], p, circle),
                Shape::Ellipse([Ok(c), Ok(d)], q, other),
            ) if circle == other => Shape::Ellipse(
                [Ok(a.lerp_positive(c, t)?), Ok(b.lerp_positive(d, t)?)],
                p.lerp(q, t)?,
                *circle,
            ),
            (Shape::Polygon(rule, a, radius), Shape::Polygon(other, b, to))
                if a.len() == b.len() && rule == other =>
            {
                let points = a.iter().zip(b).map(|(a, b)| a.lerp(b, t));
                Shape::Polygon(
                    *rule,
                    points.collect::<Option<_>>()?,
                    t.of(*radius, *to).max(0.0),
                )
            }
            _ => return None,
        };
        Some(ClipPath(Some(Rc::new((shape, *area)))))
    }
}

/// The `clip` property: top, right, bottom, left, from the top left corner.
#[derive(Clone, Copy, PartialEq)]
pub(crate) struct ClipRect(pub(crate) [Option<f32>; 4]);

impl Css for ClipRect {
    fn parse(p: &mut P, cx: &Ctx) -> Option<ClipRect> {
        eq(function(p)?, "rect").then_some(())?;
        nested(p, |p| {
            let mut edges = [None; 4];
            for edge in &mut edges {
                *edge = Auto::<Px>::parse(p, cx)?.0.map(|px| px.0);
                comma(p);
            }
            Some(ClipRect(edges))
        })
    }
    fn write(&self, out: &mut Out) {
        out.extend_from_slice(b"rect(");
        write_list(&self.0, ", ", out, |edge, out| {
            Auto(edge.map(Px)).write(out)
        });
        out.push(b')');
    }
    fn lerp(&self, to: &ClipRect, t: Mixing) -> Option<ClipRect> {
        (self.0.map(|it| it.is_some()) == to.0.map(|it| it.is_some()))
            .then(|| ClipRect([0, 1, 2, 3].map(|i| Some(t.of(self.0[i]?, to.0[i]?)))))
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) struct ClipMargin(pub(crate) BoxArea, pub(crate) f32);

impl Css for ClipMargin {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        let (first, margin) = (BoxArea::parse(p, cx), Px::parse(p, cx));
        let area = first.or_else(|| BoxArea::parse(p, cx));
        (area.is_some() || margin.is_some()).then(|| {
            ClipMargin(
                area.unwrap_or(BoxArea::PaddingBox),
                margin.map_or(0.0, |it| it.0),
            )
        })
    }
    fn write(&self, out: &mut Out) {
        if self.0 != BoxArea::PaddingBox {
            self.0.write(out);
            if self.1 == 0.0 {
                return;
            }
            out.push(b' ');
        }
        write_px(self.1, out);
    }
}

// ───────────────────────────── grid ─────────────────────────────

#[derive(Clone, PartialEq)]
pub(crate) enum Breadth {
    Length(Lp),
    Fr(f32),
    Auto,
    MinContent,
    MaxContent,
}

impl Css for Breadth {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Breadth> {
        Some(match () {
            () if keyword(p, "auto") => Breadth::Auto,
            () if keyword(p, "min-content") => Breadth::MinContent,
            () if keyword(p, "max-content") => Breadth::MaxContent,
            () => match fr(p, cx) {
                Some(fr) => Breadth::Fr(fr),
                None => Breadth::Length(Lp::positive(p, cx)?),
            },
        })
    }
    fn write(&self, out: &mut Out) {
        match self {
            Breadth::Length(length) => length.write(out),
            Breadth::Fr(fr) => {
                write_number(*fr, out);
                out.extend_from_slice(b"fr");
            }
            Breadth::Auto => out.extend_from_slice(b"auto"),
            Breadth::MinContent => out.extend_from_slice(b"min-content"),
            Breadth::MaxContent => out.extend_from_slice(b"max-content"),
        }
    }
    fn lerp(&self, to: &Breadth, t: Mixing) -> Option<Breadth> {
        match (self, to) {
            (Breadth::Length(a), Breadth::Length(b)) => a.lerp_positive(b, t).map(Breadth::Length),
            (Breadth::Fr(a), Breadth::Fr(b)) => Some(Breadth::Fr(t.of(*a, *b).max(0.0))),
            _ => Some(t.pick(self, to).clone()),
        }
    }
}

#[derive(Clone, PartialEq)]
pub(crate) enum Track {
    Breadth(Breadth),
    MinMax(Breadth, Breadth),
    FitContent(Lp),
}

impl Css for Track {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Track> {
        if let Some(breadth) = Breadth::parse(p, cx) {
            return Some(Track::Breadth(breadth));
        }
        attempt(p, |p| match function(p)? {
            name if eq(name, "minmax") => nested(p, |p| {
                let min = Breadth::parse(p, cx).filter(|min| !matches!(min, Breadth::Fr(_)))?;
                comma(p).then_some(())?;
                Some(Track::MinMax(min, Breadth::parse(p, cx)?))
            }),
            name if eq(name, "fit-content") => {
                nested(p, |p| Lp::positive(p, cx)).map(Track::FitContent)
            }
            _ => None,
        })
    }
    fn write(&self, out: &mut Out) {
        match self {
            Track::Breadth(breadth) => return breadth.write(out),
            Track::MinMax(min, max) => {
                out.extend_from_slice(b"minmax(");
                write_list(&[min, max], ", ", out, |breadth, out| breadth.write(out));
            }
            Track::FitContent(limit) => {
                out.extend_from_slice(b"fit-content(");
                limit.write(out);
            }
        }
        out.push(b')');
    }
    fn lerp(&self, to: &Track, t: Mixing) -> Option<Track> {
        match (self, to) {
            (Track::Breadth(a), Track::Breadth(b)) => a.lerp(b, t).map(Track::Breadth),
            (Track::MinMax(a, b), Track::MinMax(c, d)) => {
                Some(Track::MinMax(a.lerp(c, t)?, b.lerp(d, t)?))
            }
            (Track::FitContent(a), Track::FitContent(b)) => {
                a.lerp_positive(b, t).map(Track::FitContent)
            }
            _ => Some(t.pick(self, to).clone()),
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Repetition {
    AutoFill,
    AutoFit,
    Count(u16),
}

#[derive(Clone, PartialEq)]
pub(crate) enum TrackItem {
    Track(Track),
    Repeat(Repetition, TrackList),
}

/// `names` has one more item than `items`.
#[derive(Clone, Default, PartialEq)]
pub(crate) struct TrackList {
    pub(crate) items: Vec<TrackItem>,
    pub(crate) names: Vec<Vec<Str>>,
}

pub(crate) fn line_names(p: &mut P) -> Vec<Str> {
    attempt(p, |p| {
        matches!(p.next().ok()?, Token::OpenSquare).then_some(())?;
        nested(p, |p| {
            Some(core::iter::from_fn(|| custom_ident(p)).collect())
        })
    })
    .unwrap_or_default()
}

impl TrackList {
    pub(crate) fn repeats_automatically(&self) -> bool {
        self.items.iter().any(|it| {
            matches!(
                it,
                TrackItem::Repeat(Repetition::AutoFill | Repetition::AutoFit, _)
            )
        })
    }

    pub(crate) fn parse(p: &mut P, cx: &Ctx) -> Option<TrackList> {
        let mut list = TrackList::default();
        loop {
            list.names.push(line_names(p));
            if let Some(track) = Track::parse(p, cx) {
                list.items.push(TrackItem::Track(track));
            } else if attempt(p, |p| p.expect_function_matching(b"repeat").ok()).is_some() {
                list.items.push(nested(p, |p| {
                    let count = match () {
                        () if keyword(p, "auto-fill") => Repetition::AutoFill,
                        () if keyword(p, "auto-fit") => Repetition::AutoFit,
                        () => {
                            let count = integer(p, cx).filter(|count| *count > 0)?;
                            Repetition::Count(count.min(10_000) as u16)
                        }
                    };
                    comma(p).then_some(())?;
                    Some(TrackItem::Repeat(count, TrackList::parse(p, cx)?))
                })?);
            } else {
                return (!list.items.is_empty()).then_some(list);
            }
        }
    }

    fn write(&self, out: &mut Out) {
        let start = out.len();
        for (index, names) in self.names.iter().enumerate() {
            if !names.is_empty() {
                out.extend_from_slice(if out.len() > start { b" [" } else { b"[" });
                write_list(names, " ", out, Str::write);
                out.push(b']');
            }
            let Some(item) = self.items.get(index) else {
                break;
            };
            if out.len() > start {
                out.push(b' ');
            }
            match item {
                TrackItem::Track(track) => track.write(out),
                TrackItem::Repeat(count, list) => {
                    let _ = match count {
                        Repetition::AutoFill => write!(out, "repeat(auto-fill, "),
                        Repetition::AutoFit => write!(out, "repeat(auto-fit, "),
                        Repetition::Count(count) => write!(out, "repeat({count}, "),
                    };
                    list.write(out);
                    out.push(b')');
                }
            }
        }
    }

    fn lerp(&self, to: &TrackList, t: Mixing) -> Option<TrackList> {
        (self.items.len() == to.items.len()).then_some(())?;
        let items = self.items.iter().zip(&to.items).map(|pair| match pair {
            (TrackItem::Track(a), TrackItem::Track(b)) => a.lerp(b, t).map(TrackItem::Track),
            (TrackItem::Repeat(count, a), TrackItem::Repeat(other, b))
                if count == other && matches!(count, Repetition::Count(_)) =>
            {
                Some(TrackItem::Repeat(*count, a.lerp(b, t)?))
            }
            _ => None,
        });
        Some(TrackList {
            items: items.collect::<Option<_>>()?,
            names: t.pick(self, to).names.clone(),
        })
    }
}

#[derive(Clone, PartialEq)]
pub(crate) enum Template {
    None,
    Subgrid(Rc<SubgridNames>),
    Tracks(Rc<TrackList>),
}

/// The names of the lines before `repeat(auto-fill)`, in it, and after it.
#[derive(Default, PartialEq)]
pub(crate) struct SubgridNames([Vec<Vec<Str>>; 3]);

impl SubgridNames {
    pub(crate) fn count(&self) -> usize {
        self.0[0].len() + self.0[2].len()
    }

    pub(crate) fn expand(&self, lines: usize) -> impl Iterator<Item = &Vec<Str>> {
        let [before, repeated, after] = &self.0;
        let times = lines.saturating_sub(self.count()) / repeated.len().max(1);
        before
            .iter()
            .chain(repeated.iter().cycle().take(times * repeated.len()))
            .chain(after)
    }
}

impl Template {
    pub(crate) fn is_subgrid(&self) -> bool {
        matches!(self, Template::Subgrid(_))
    }
}

impl Css for Template {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Template> {
        if keyword(p, "none") {
            return Some(Template::None);
        }
        if keyword(p, "subgrid") {
            let lists = |p: &mut P| {
                let next = || {
                    let start = p.position();
                    let names = line_names(p);
                    (p.position() != start).then_some(names)
                };
                core::iter::from_fn(next).collect::<Vec<_>>()
            };
            let (mut names, mut part) = (SubgridNames::default(), 0);
            loop {
                names.0[part].extend(lists(p));
                if attempt(p, |p| p.expect_function_matching(b"repeat").ok()).is_none() {
                    return Some(Template::Subgrid(Rc::new(names)));
                }
                let (count, repeated) = nested(p, |p| {
                    let count = if keyword(p, "auto-fill") {
                        None
                    } else {
                        Some(integer(p, cx).filter(|it| *it > 0)?.min(1000))
                    };
                    comma(p).then(|| (count, lists(p)))
                })?;
                match count {
                    Some(count) => {
                        (0..count).for_each(|_| names.0[part].extend_from_slice(&repeated))
                    }
                    None => (names.0[1], part) = (repeated, 2),
                }
            }
        }
        TrackList::parse(p, cx).map(|list| Template::Tracks(Rc::new(list)))
    }
    fn write(&self, out: &mut Out) {
        match self {
            Template::None => out.extend_from_slice(b"none"),
            Template::Subgrid(names) => {
                let [before, repeated, after] = names.0.each_ref().map(|it| {
                    it.iter()
                        .map(|it| [" [", &it.join(" "), "]"].concat())
                        .collect::<String>()
                });
                let repeated = if repeated.is_empty() {
                    repeated
                } else {
                    format!(" repeat(auto-fill,{repeated})")
                };
                out.extend(["subgrid", &before, &repeated, &after].concat().bytes());
            }
            Template::Tracks(list) => list.write(out),
        }
    }
    fn lerp(&self, to: &Template, t: Mixing) -> Option<Template> {
        match (self, to) {
            (Template::Tracks(a), Template::Tracks(b)) => {
                a.lerp(b, t).map(|list| Template::Tracks(Rc::new(list)))
            }
            _ => None,
        }
    }
}

#[derive(Clone, PartialEq)]
pub(crate) struct AutoTracks(pub(crate) Rc<[Track]>);

impl Css for AutoTracks {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        let tracks: Rc<[Track]> = core::iter::from_fn(|| Track::parse(p, cx)).collect();
        (!tracks.is_empty()).then_some(AutoTracks(tracks))
    }
    fn write(&self, out: &mut Out) {
        write_list(&self.0, " ", out, Track::write);
    }
}

#[derive(Clone, Default, PartialEq)]
pub(crate) struct Areas(pub(crate) Rc<[Str]>);

impl Areas {
    /// Columns and rows.
    pub(crate) fn counts(&self) -> [usize; 2] {
        [
            self.0
                .first()
                .map_or(0, |it| it.split_ascii_whitespace().count()),
            self.0.len(),
        ]
    }

    pub(crate) fn named(&self) -> Vec<(&str, [core::ops::Range<usize>; 2])> {
        let (mut areas, mut known) = (
            Vec::<(&str, [core::ops::Range<usize>; 2])>::new(),
            crate::name::Map::default(),
        );
        for (row, cells) in self.0.iter().enumerate() {
            for (column, name) in cells
                .split_ascii_whitespace()
                .enumerate()
                .filter(|it| !it.1.starts_with('.'))
            {
                let index = *known.entry(name).or_insert(areas.len());
                match areas.get_mut(index) {
                    Some((_, area)) => {
                        (area[0].end, area[1].end) = (area[0].end.max(column + 1), row + 1)
                    }
                    None => areas.push((name, [column..column + 1, row..row + 1])),
                }
            }
        }
        areas
    }
}

impl Css for Areas {
    fn parse(p: &mut P, _: &Ctx) -> Option<Areas> {
        if keyword(p, "none") {
            return Some(Areas::default());
        }
        let is_in_name =
            |it: char| it.is_ascii_alphanumeric() || matches!(it, '-' | '_') || !it.is_ascii();
        let normalized = |mut row: &str| {
            let mut cells = Vec::new();
            while let Some(first) = {
                row = row.trim_ascii_start();
                row.chars().next()
            } {
                let rest = if first == '.' {
                    row.trim_start_matches('.')
                } else {
                    row.trim_start_matches(is_in_name)
                };
                (rest.len() < row.len()).then_some(())?;
                cells.push(if first == '.' {
                    "."
                } else {
                    &row[..row.len() - rest.len()]
                });
                row = rest;
            }
            (!cells.is_empty()).then(|| cells.join(" ").into())
        };
        let areas = Areas(
            core::iter::from_fn(|| Some(normalized(text(string(p)?)))).collect::<Option<_>>()?,
        );
        let ([columns, rows], cells) = (areas.counts(), || {
            areas.0.iter().map(|it| it.split_ascii_whitespace())
        });
        ((1..1000).contains(&rows) && columns < 1000 && cells().all(|it| it.count() == columns))
            .then_some(())?;
        let (named, all): (_, Vec<_>) = (areas.named(), cells().flatten().collect());
        let is_filled = |(name, [x, y]): &(&str, [core::ops::Range<usize>; 2])| {
            y.clone()
                .all(|y| all[y * columns..][x.clone()].iter().all(|it| it == name))
        };
        let covered: usize = named.iter().map(|it| it.1[0].len() * it.1[1].len()).sum();
        let is_valid =
            covered == all.iter().filter(|it| **it != ".").count() && named.iter().all(is_filled);
        is_valid.then(|| areas.clone())
    }
    fn write(&self, out: &mut Out) {
        if self.0.is_empty() {
            out.extend_from_slice(b"none");
        }
        write_list(&self.0, " ", out, |row, out| {
            write_string(row.as_bytes(), out)
        });
    }
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) enum GridLine {
    Auto,
    Line(i16),
    Span(u16),
    /// 0 is no index.
    NamedLine(Str, i16),
    NamedSpan(Str, u16),
}

impl Css for GridLine {
    fn parse(p: &mut P, cx: &Ctx) -> Option<GridLine> {
        if keyword(p, "auto") {
            return Some(GridLine::Auto);
        }
        let (mut span, mut index, mut name) = (false, None, None);
        loop {
            if !span && keyword(p, "span") {
                span = true;
            } else if index.is_none()
                && let Some(value) = integer(p, cx)
            {
                index = Some(value.clamp(-10_000, 10_000) as i16);
            } else if name.is_none()
                && let Some(value) = custom_ident(p)
            {
                name = Some(value);
            } else {
                break;
            }
        }
        Some(match (span, index, name) {
            (_, Some(0), _) | (true, Some(..0), _) | (_, None, None) => return None,
            (true, Some(count), None) => GridLine::Span(count as u16),
            (true, count, Some(name)) => GridLine::NamedSpan(name, count.unwrap_or(1) as u16),
            (false, Some(index), None) => GridLine::Line(index),
            (false, index, Some(name)) => GridLine::NamedLine(name, index.unwrap_or(0)),
        })
    }
    fn write(&self, out: &mut Out) {
        let _ = match self {
            GridLine::Auto => write!(out, "auto"),
            GridLine::Line(line) => write!(out, "{line}"),
            GridLine::Span(count) => write!(out, "span {count}"),
            GridLine::NamedLine(name, 0) => write!(out, "{name}"),
            GridLine::NamedLine(name, index) => write!(out, "{index} {name}"),
            GridLine::NamedSpan(name, 1) => write!(out, "span {name}"),
            GridLine::NamedSpan(name, count) => write!(out, "span {count} {name}"),
        };
    }
}

// ───────────────────────────── generated content ─────────────────────────────

#[derive(Clone, PartialEq)]
pub(crate) enum ListStyleType {
    None,
    Named(Str),
    String(Str),
    Symbols(Rc<CounterStyle>),
}

impl Css for ListStyleType {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        if function(p).is_some() {
            return nested(p, |p| {
                Some(ListStyleType::Symbols(Rc::new(CounterStyle::anonymous(
                    p, cx,
                ))))
            });
        }
        if keyword(p, "none") {
            return Some(ListStyleType::None);
        }
        (string(p).map(|value| ListStyleType::String(text(value).into()))).or_else(|| {
            custom_ident(p)
                .map(|it| ListStyleType::Named(crate::counter_style::canonical_name(&it)))
        })
    }
    fn write(&self, out: &mut Out) {
        match self {
            ListStyleType::None => out.extend_from_slice(b"none"),
            ListStyleType::Named(name) => name.write(out),
            ListStyleType::String(value) => write_string(value.as_bytes(), out),
            ListStyleType::Symbols(style) => style.write_anonymous(out),
        }
    }
}

#[derive(Clone, PartialEq)]
pub(crate) enum ContentItem {
    String(Str),
    Image(Image),
    Counter(Str, Option<Str>, ListStyleType),
    Quote { open: bool, visible: bool },
}

#[derive(Clone, PartialEq)]
pub(crate) enum Content {
    Normal,
    None,
    /// With the alternative text.
    Items(Rc<[ContentItem]>, Option<Rc<[ContentItem]>>),
}

fn content_item(p: &mut P, cx: &Ctx) -> Option<ContentItem> {
    if let Some(value) = string(p) {
        return Some(ContentItem::String(text(value).into()));
    }
    for (name, open, visible) in [
        ("open-quote", true, true),
        ("close-quote", false, true),
        ("no-open-quote", true, false),
        ("no-close-quote", false, false),
    ] {
        if keyword(p, name) {
            return Some(ContentItem::Quote { open, visible });
        }
    }
    if let Some(image) = Image::parse(p, cx) {
        return Some(ContentItem::Image(image));
    }
    let name = function(p)?;
    let plural = eq(name, "counters");
    (plural || eq(name, "counter")).then_some(())?;
    nested(p, |p| {
        let counter = custom_ident(p)?;
        let separator = match plural {
            true => Some(text(comma(p).then(|| string(p))??).into()),
            false => None,
        };
        let style = match comma(p) {
            true => ListStyleType::parse(p, cx)?,
            false => ListStyleType::Named("decimal".into()),
        };
        Some(ContentItem::Counter(counter, separator, style))
    })
}

fn write_content_item(item: &ContentItem, out: &mut Out) {
    match item {
        ContentItem::String(value) => write_string(value.as_bytes(), out),
        ContentItem::Image(image) => image.write(out),
        ContentItem::Counter(name, separator, style) => {
            out.extend(
                if separator.is_some() {
                    "counters("
                } else {
                    "counter("
                }
                .bytes(),
            );
            name.write(out);
            if let Some(separator) = separator {
                out.extend_from_slice(b", ");
                write_string(separator.as_bytes(), out);
            }
            if !matches!(style, ListStyleType::Named(name) if **name == *"decimal") {
                out.extend_from_slice(b", ");
                style.write(out);
            }
            out.push(b')');
        }
        ContentItem::Quote { open, visible } => {
            let _ = write!(
                out,
                "{}{}-quote",
                if *visible { "" } else { "no-" },
                if *open { "open" } else { "close" }
            );
        }
    }
}

impl Css for Content {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Content> {
        if keyword(p, "normal") {
            return Some(Content::Normal);
        }
        if keyword(p, "none") {
            return Some(Content::None);
        }
        let items = |p: &mut P| {
            core::iter::from_fn(|| attempt(p, |p| content_item(p, cx))).collect::<Rc<[_]>>()
        };
        Some(Content::Items(
            Some(items(p)).filter(|it| !it.is_empty())?,
            delim(p, b'/').then(|| items(p)),
        ))
    }
    fn write(&self, out: &mut Out) {
        match self {
            Content::Normal => out.extend_from_slice(b"normal"),
            Content::None => out.extend_from_slice(b"none"),
            Content::Items(items, alt) => {
                write_list(items, " ", out, write_content_item);
                if let Some(alt) = alt {
                    out.extend_from_slice(b" / ");
                    write_list(alt, " ", out, write_content_item);
                }
            }
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Counter(pub(crate) Str, pub(crate) Option<i32>);

impl Css for Counter {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Counter> {
        Some(Counter(custom_ident(p)?, integer(p, cx)))
    }
    fn write(&self, out: &mut Out) {
        let _ = write!(out, "{} {}", self.0, self.1.unwrap_or(0));
    }
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Quotes(pub(crate) Option<Rc<[Str]>>);

impl Css for Quotes {
    fn parse(p: &mut P, _: &Ctx) -> Option<Quotes> {
        if keyword(p, "auto") {
            return Some(Quotes(None));
        }
        if keyword(p, "none") {
            return Some(Quotes(Some(Rc::default())));
        }
        let marks: Rc<[Str]> = core::iter::from_fn(|| Some(text(string(p)?).into())).collect();
        (!marks.is_empty() && marks.len().is_multiple_of(2)).then_some(Quotes(Some(marks)))
    }
    fn write(&self, out: &mut Out) {
        match self.0.as_deref() {
            None => out.extend_from_slice(b"auto"),
            Some([]) => out.extend_from_slice(b"none"),
            Some(marks) => write_list(marks, " ", out, |mark, out| {
                write_string(mark.as_bytes(), out)
            }),
        }
    }
}

// ───────────────────────────── animations ─────────────────────────────

#[derive(Clone, PartialEq)]
pub(crate) enum Easing {
    /// With its keyword, if it is given as one.
    Bezier([f64; 4], &'static str),
    Steps(i32, StepPosition),
    /// Input and output. Empty for `linear`.
    Linear(Rc<[[f32; 2]]>),
}

impl Easing {
    pub(crate) const EASE: Easing = Easing::Bezier([0.25, 0.1, 0.25, 1.0], "ease");
    pub(crate) const EASE_IN_OUT: Easing = Easing::Bezier([0.42, 0.0, 0.58, 1.0], "ease-in-out");

    pub(crate) fn linear() -> Easing {
        Easing::Linear(Rc::default())
    }

    pub(crate) fn apply(&self, t: f64, before: bool) -> f64 {
        match self {
            Easing::Linear(points) => {
                if points.len() < 2 {
                    return t;
                }
                let next = points
                    .partition_point(|point| point[0] <= t as f32)
                    .clamp(1, points.len() - 1);
                let [[x0, y0], [x1, y1]] =
                    [points[next - 1], points[next]].map(|it| it.map(f64::from));
                match x1 == x0 {
                    true => {
                        if t < x0 || before && t == x0 {
                            y0
                        } else {
                            y1
                        }
                    }
                    false => y0 + (y1 - y0) * (t - x0) / (x1 - x0),
                }
            }
            Easing::Steps(count, position) => {
                let count = f64::from(*count);
                let mut step = (t * count).floor();
                if matches!(
                    position,
                    StepPosition::Start | StepPosition::JumpStart | StepPosition::JumpBoth
                ) {
                    step += 1.0;
                }
                if before && (t * count).fract() == 0.0 {
                    step -= 1.0;
                }
                let jumps = match position {
                    StepPosition::JumpNone => count - 1.0,
                    StepPosition::JumpBoth => count + 1.0,
                    _ => count,
                };
                let step = if t >= 0.0 { step.max(0.0) } else { step };
                (if t <= 1.0 { step.min(jumps) } else { step }) / jumps.max(1.0)
            }
            Easing::Bezier(points, _) => {
                let [x1, y1, x2, y2] = *points;
                let slope = |[x, y]: [f64; 2], [u, v]: [f64; 2]| {
                    if x > 0.0 {
                        y / x
                    } else if y == 0.0 && u > 0.0 {
                        v / u
                    } else {
                        0.0
                    }
                };
                if t <= 0.0 {
                    return t * slope([x1, y1], [x2, y2]) + 0.0;
                } else if t >= 1.0 {
                    return 1.0 + (t - 1.0) * slope([1.0 - x2, 1.0 - y2], [1.0 - x1, 1.0 - y1]);
                }
                let curve = |a: f64, b: f64, s: f64| {
                    ((1.0 - 3.0 * b + 3.0 * a) * s + 3.0 * b - 6.0 * a) * s * s + 3.0 * a * s
                };
                let (mut low, mut high, mut at) = (0.0, 1.0, t);
                for _ in 0..40 {
                    let error = curve(x1, x2, at) - t;
                    if error.abs() < 1e-10 {
                        break;
                    }
                    *(if error < 0.0 { &mut low } else { &mut high }) = at;
                    let next = at
                        - error
                            / ((3.0 * (1.0 - 3.0 * x2 + 3.0 * x1) * at + 6.0 * x2 - 12.0 * x1)
                                * at
                                + 3.0 * x1);
                    at = if next > low && next < high {
                        next
                    } else {
                        (low + high) / 2.0
                    };
                }
                curve(y1, y2, at)
            }
        }
    }
}

fn linear_points(p: &mut P, cx: &Ctx) -> Option<Rc<[[f32; 2]]>> {
    let mut points: Vec<(Option<f32>, f32)> = Vec::new();
    loop {
        let before = [percentage(p, cx), percentage(p, cx)];
        let output = number(p, cx)?;
        let [first, second] = if before[0].is_some() {
            before
        } else {
            [percentage(p, cx), percentage(p, cx)]
        };
        points.push((first, output));
        if let Some(input) = second {
            points.push((Some(input), output));
        }
        if !comma(p) {
            break;
        }
    }
    let inputs = spread_positions(points.iter().map(|point| point.0).collect());
    Some(
        inputs
            .into_iter()
            .zip(points)
            .map(|(input, point)| [input, point.1])
            .collect(),
    )
}

/// Fills in the positions of gradient stops or of `linear()` points, from 0 to 1.
pub(crate) fn spread_positions(mut positions: Vec<Option<f32>>) -> Vec<f32> {
    let Some(last) = positions.len().checked_sub(1) else {
        return Vec::new();
    };
    positions[0].get_or_insert(0.0);
    positions[last].get_or_insert(1.0);
    let mut resolved: Vec<f32> = Vec::with_capacity(positions.len());
    for (index, position) in positions.iter().enumerate() {
        let Some(position) = position else { continue };
        let previous = resolved.last().copied().unwrap_or(*position);
        let position = position.max(previous);
        let steps = index + 1 - resolved.len();
        resolved
            .extend((1..=steps).map(|step| mix(previous, position, step as f32 / steps as f32)));
    }
    resolved
}

impl Css for Easing {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Easing> {
        if let Some(name) = function(p) {
            return nested(p, |p| match () {
                () if eq(name, "linear") => linear_points(p, cx).map(Easing::Linear),
                () if eq(name, "steps") => {
                    let count = integer(p, cx)?;
                    let position = if comma(p) {
                        StepPosition::parse(p, cx)?
                    } else {
                        StepPosition::End
                    };
                    Some(Easing::Steps(
                        count.max(if position == StepPosition::JumpNone {
                            2
                        } else {
                            1
                        }),
                        position,
                    ))
                }
                () => {
                    let [x1, y1, x2, y2] = commas(p, |p| {
                        Some(Node::parse(p, &Options::new(Kind::Number))?.compute(cx, 1.0))
                    })?
                    .try_into()
                    .ok()?;
                    let [x1, x2] =
                        [x1, x2].map(|it| if it.is_nan() { 0.0 } else { it.clamp(0.0, 1.0) });
                    let [y1, y2] = [y1, y2].map(|it| {
                        if it.is_nan() {
                            0.0
                        } else {
                            it.clamp(f32::MIN.into(), f32::MAX.into())
                        }
                    });
                    Some(Easing::Bezier([x1, y1, x2, y2], ""))
                }
            });
        }
        Some(match &ident(p)?.to_ascii_lowercase()[..] {
            b"linear" => Easing::linear(),
            b"ease" => Easing::EASE,
            b"ease-in" => Easing::Bezier([0.42, 0.0, 1.0, 1.0], "ease-in"),
            b"ease-out" => Easing::Bezier([0.0, 0.0, 0.58, 1.0], "ease-out"),
            b"ease-in-out" => Easing::EASE_IN_OUT,
            b"step-start" => Easing::Steps(1, StepPosition::Start),
            b"step-end" => Easing::Steps(1, StepPosition::End),
            _ => return None,
        })
    }
    fn write(&self, out: &mut Out) {
        match self {
            Easing::Bezier(points, "") => {
                out.extend_from_slice(b"cubic-bezier(");
                write_list(points, ", ", out, |it, out| write_number(*it as f32, out));
                out.push(b')');
            }
            Easing::Bezier(_, name) => out.extend_from_slice(name.as_bytes()),
            Easing::Steps(count, StepPosition::End | StepPosition::JumpEnd) => {
                _ = write!(out, "steps({count})")
            }
            Easing::Steps(count, position) => {
                _ = write!(out, "steps({count}, {})", position.name())
            }
            Easing::Linear(points) if points.is_empty() => out.extend_from_slice(b"linear"),
            Easing::Linear(points) => {
                out.extend_from_slice(b"linear(");
                write_list(points, ", ", out, |[input, output], out| {
                    write_number(*output, out);
                    out.push(b' ');
                    write_number(input * 100.0, out);
                    out.push(b'%');
                });
                out.push(b')');
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) struct Iterations(pub(crate) f32);

impl Css for Iterations {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        match keyword(p, "infinite") {
            true => Some(Iterations(f32::INFINITY)),
            false => Positive::parse(p, cx).map(|count| Iterations(count.0)),
        }
    }
    fn write(&self, out: &mut Out) {
        match self.0.is_finite() {
            true => write_number(self.0, out),
            false => out.extend_from_slice(b"infinite"),
        }
    }
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct AnimationName(pub(crate) Option<Str>);

impl Css for AnimationName {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        match string(p) {
            Some(name) => Some(AnimationName(Some(text(name).into()))),
            None => NoneOr::parse(p, cx).map(|name| AnimationName(name.0)),
        }
    }
    fn write(&self, out: &mut Out) {
        match &self.0 {
            Some(name)
                if name.eq_ignore_ascii_case("none")
                    || name.is_empty()
                    || crate::grammar::is_reserved(name.as_bytes()) =>
            {
                write_string(name.as_bytes(), out)
            }
            name => NoneOr(name.clone()).write(out),
        }
    }
}

/// `auto` only means something to scroll-driven animations.
#[derive(Clone, Copy, PartialEq)]
/// Negative for `auto`.
pub(crate) struct Duration(pub(crate) f32);

impl Css for Duration {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Self> {
        match keyword(p, "auto") {
            true => Some(Duration(-1.0)),
            false => Time::parse(p, cx)
                .filter(|time| time.0 >= 0.0)
                .map(|time| Duration(time.0)),
        }
    }
    fn write(&self, out: &mut Out) {
        if self.0 < 0.0 {
            out.extend_from_slice(b"auto")
        } else {
            Time(self.0).write(out)
        }
    }
}

#[derive(Clone, PartialEq)]
pub(crate) enum Timeline {
    Auto,
    None,
    Named(Str),
    Anonymous(Watch, Axis),
}

#[derive(Clone, PartialEq)]
pub(crate) enum Watch {
    Scroller(Scroller),
    /// With the insets.
    View([Auto<Lp>; 2]),
}

keywords! {
    Scroller { Nearest = "nearest", Root = "root", Itself = "self" }
    StepPosition { Start = "start", End = "end", JumpStart = "jump-start", JumpEnd = "jump-end", JumpNone = "jump-none", JumpBoth = "jump-both" }
    RangeName { Cover = "cover", Contain = "contain", Entry = "entry", Exit = "exit", EntryCrossing = "entry-crossing",
        ExitCrossing = "exit-crossing", Scroll = "scroll" }
    Axis { Block = "block", Inline = "inline", X = "x", Y = "y" }
}

pub(crate) fn view_insets(p: &mut P, cx: &Ctx) -> Option<[Auto<Lp>; 2]> {
    let start = Auto::parse(p, cx)?;
    Some([start.clone(), Auto::parse(p, cx).unwrap_or(start)])
}

impl Css for Timeline {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Timeline> {
        Some(match () {
            () if keyword(p, "auto") => Timeline::Auto,
            () if keyword(p, "none") => Timeline::None,
            () => match dashed_ident(p) {
                Some(name) => Timeline::Named(name),
                None => {
                    let is_view = eq(function(p)?, "view");
                    nested(p, |p| {
                        let before = Axis::parse(p, cx);
                        let how = match is_view {
                            true => {
                                Watch::View(view_insets(p, cx).unwrap_or([Auto(None), Auto(None)]))
                            }
                            false => {
                                Watch::Scroller(Scroller::parse(p, cx).unwrap_or(Scroller::Nearest))
                            }
                        };
                        Some(Timeline::Anonymous(
                            how,
                            before.or_else(|| Axis::parse(p, cx)).unwrap_or(Axis::Block),
                        ))
                    })?
                }
            },
        })
    }
    fn write(&self, out: &mut Out) {
        out.extend_from_slice(b"auto");
    }
}

/// Neither for `normal`.
#[derive(Clone, Default, PartialEq)]
pub(crate) struct RangeEdge(pub(crate) Option<RangeName>, pub(crate) Option<Lp>);

impl Css for RangeEdge {
    fn parse(p: &mut P, cx: &Ctx) -> Option<RangeEdge> {
        Some(if keyword(p, "normal") {
            RangeEdge::default()
        } else {
            RangeEdge(RangeName::parse(p, cx), Lp::parse(p, cx))
        })
    }
    fn write(&self, out: &mut Out) {
        out.extend(
            self.0
                .map_or_else(
                    || if self.1.is_none() { "normal" } else { "" },
                    RangeName::name,
                )
                .bytes(),
        );
        out.extend((self.0.is_some() && self.1.is_some()).then_some(b' '));
        self.1.iter().for_each(|it| it.write(out));
    }
}

// ───────────────────────────── SVG ─────────────────────────────

#[derive(Clone, Copy, PartialEq)]
pub(crate) struct Zoom(pub(crate) f32);

impl Css for Zoom {
    fn parse(p: &mut P, cx: &Ctx) -> Option<Zoom> {
        match keyword(p, "normal") {
            true => Some(Zoom(1.0)),
            false => {
                number_or_percentage(p, cx).map(|zoom| Zoom(if zoom > 0.0 { zoom } else { 1.0 }))
            }
        }
    }
    fn write(&self, out: &mut Out) {
        write_number(self.0, out);
    }
    fn lerp(&self, to: &Zoom, t: Mixing) -> Option<Zoom> {
        Some(Zoom(
            Some(t.of(self.0, to.0))
                .filter(|it| *it > 0.0)
                .unwrap_or(1.0),
        ))
    }
}
