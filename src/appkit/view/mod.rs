//! Views: one Rust object per AppKit view, addressed by [`Kind`], configured
//! through typed [`Prop`]s and reporting back through [`ViewSink`].
//!
//! Every kind lives in its own module behind the [`Widget`] trait. [`View`]
//! owns the widget plus what all kinds share: size constraints, layer-backed
//! decoration, and the target/delegate object AppKit calls into.

use core::cell::{Cell, OnceCell, Ref, RefCell, RefMut};
use core::ops::{Deref, DerefMut};
use std::collections::VecDeque;
use std::rc::{Rc, Weak};

use crate::color::Color;
use crate::error::{Error, Result};
use crate::font::Font;
use crate::geometry::{Insets, Positive, Rect, Size};
use crate::named_enum;
use crate::objc::appkit::{
    BitmapImageFileType, NSAppearance, NSApplication, NSColor, NSControl, NSLayoutConstraint,
    NSStackView, NSTableColumn, NSTableView, NSUndoManager, NSView, StackDistribution,
    TextAlignment,
};
use crate::objc::foundation::{NSObject, NSString};
use crate::objc::{
    self, AutoreleasePool, ControlEvents, Delegate, MetalViewEvents, NsStr, Object, sel,
};

mod button;
mod containers;
mod image;
mod metal;
mod misc;
mod picker;
mod progress;
mod slider;
mod table;
mod text;
mod text_editor;
mod text_field;

pub use metal::{MetalSurface, PIXEL_FORMAT as METAL_VIEW_PIXEL_FORMAT};

named_enum! {
    /// What sort of view this is. The name is what JavaScript calls it.
    pub enum Kind {
        VStack = "VStack",
        HStack = "HStack",
        ScrollView = "ScrollView",
        Group = "Group",
        SplitView = "SplitView",
        Text = "Text",
        Button = "Button",
        Checkbox = "Checkbox",
        Radio = "Radio",
        Switch = "Switch",
        TextField = "TextField",
        SecureField = "SecureField",
        SearchField = "SearchField",
        TextEditor = "TextEditor",
        Slider = "Slider",
        Picker = "Picker",
        Segmented = "Segmented",
        Progress = "Progress",
        Image = "Image",
        Divider = "Divider",
        Spacer = "Spacer",
        Table = "Table",
        /// A bare NSView that pins every child to its edges.
        View = "View",
        /// An `MTKView` JavaScript renders into with Metal.
        MetalView = "MetalView",
    }
}

impl Kind {
    /// Whether the JavaScript `value` property of this kind is text (text
    /// inputs) rather than a number.
    pub fn value_is_text(self) -> bool {
        matches!(
            self,
            Kind::TextField | Kind::SecureField | Kind::SearchField | Kind::TextEditor
        )
    }
}

named_enum! {
    /// Cross-axis placement of children in a stack.
    pub enum Align {
        /// Stretch across the stack (the default).
        Fill = "fill",
        Leading = "leading",
        Center = "center",
        Trailing = "trailing",
        Top = "top",
        Bottom = "bottom",
        FirstBaseline = "firstBaseline",
        LastBaseline = "lastBaseline",
    }
}

named_enum! {
    /// How a stack distributes children along its axis (`NSStackViewDistribution`).
    pub enum Distribution {
        /// Children keep their natural size; `grow` decides who takes slack.
        Fill = "fill",
        FillEqually = "fillEqually",
        FillProportionally = "fillProportionally",
        EqualSpacing = "equalSpacing",
        EqualCentering = "equalCentering",
        /// `NSStackViewDistributionGravityAreas`: pack at the leading edge.
        Gravity = "gravity",
    }
}

impl From<Distribution> for StackDistribution {
    fn from(d: Distribution) -> Self {
        match d {
            Distribution::Fill => StackDistribution::Fill,
            Distribution::FillEqually => StackDistribution::FillEqually,
            Distribution::FillProportionally => StackDistribution::FillProportionally,
            Distribution::EqualSpacing => StackDistribution::EqualSpacing,
            Distribution::EqualCentering => StackDistribution::EqualCentering,
            Distribution::Gravity => StackDistribution::GravityAreas,
        }
    }
}

named_enum! {
    pub enum TextAlign {
        Left = "left",
        Center = "center",
        Right = "right",
        Justified = "justified",
        Natural = "natural",
    }
}

impl From<TextAlign> for TextAlignment {
    fn from(a: TextAlign) -> Self {
        match a {
            TextAlign::Left => TextAlignment::Left,
            TextAlign::Center => TextAlignment::Center,
            TextAlign::Right => TextAlignment::Right,
            TextAlign::Justified => TextAlignment::Justified,
            TextAlign::Natural => TextAlignment::Natural,
        }
    }
}

named_enum! {
    pub enum ButtonKind {
        /// Rounded push button.
        Default = "default",
        /// The window's default button (Return activates it, accent coloured).
        Primary = "primary",
        /// Marks a destructive action (red on confirmation-styled buttons).
        Destructive = "destructive",
        /// Borderless, like a link.
        Link = "link",
        /// Square toolbar-style bezel.
        Toolbar = "toolbar",
    }
}

named_enum! {
    pub enum ImageScaling {
        /// `NSImageScaleProportionallyDown`
        Down = "down",
        /// `NSImageScaleAxesIndependently`
        Fill = "fill",
        /// `NSImageScaleNone`
        None = "none",
        /// `NSImageScaleProportionallyUpOrDown`
        Fit = "fit",
    }
}

impl From<ImageScaling> for objc::appkit::ImageScaling {
    fn from(s: ImageScaling) -> Self {
        use objc::appkit::ImageScaling as Ns;
        match s {
            ImageScaling::Down => Ns::ProportionallyDown,
            ImageScaling::Fill => Ns::AxesIndependently,
            ImageScaling::None => Ns::None,
            ImageScaling::Fit => Ns::ProportionallyUpOrDown,
        }
    }
}

pub enum ImageSource<'a> {
    None,
    /// An SF Symbol name.
    Symbol(NsStr<'a>),
    /// A file path.
    File(NsStr<'a>),
    /// Encoded image bytes (PNG, JPEG, …).
    Data(&'a [u8]),
}

pub struct Column<'a> {
    pub id: NsStr<'a>,
    pub title: NsStr<'a>,
    /// `None` for automatic.
    pub width: Option<Positive>,
}

/// A table's contents. Cells are read as their rows scroll into view, so
/// this is asked for a handful of cells at a time however many rows it has.
pub trait TableRows {
    fn len(&self) -> usize;
    /// `None` past the end of the row (or of the table) shows an empty cell.
    fn cell(&self, row: usize, column: usize) -> Option<NsStr<'_>>;
}

/// A typed property assignment. Which kinds accept which props is decided
/// by each [`Widget`]; the rest come back as [`Error::UnknownProp`].
pub enum Prop<'a> {
    // every view
    Hidden(bool),
    Alpha(f64),
    Tooltip(Option<NsStr<'a>>),
    Identifier(Option<NsStr<'a>>),
    Width(Option<f64>),
    Height(Option<f64>),
    MinWidth(Option<f64>),
    MaxWidth(Option<f64>),
    MinHeight(Option<f64>),
    MaxHeight(Option<f64>),
    /// 0 hugs content; larger values take leftover space sooner.
    Grow(f64),
    Background(Option<Color>),
    CornerRadius(f64),
    Border {
        width: f64,
        color: Option<Color>,
    },
    // For the `Option` props below whose doc does not say otherwise, `None`
    // restores the default the kind was created with; that default is a
    // const in the widget, never repeated by the caller.
    Spacing(Option<f64>),
    Padding(Option<Insets>),
    Align(Option<Align>),
    Distribution(Option<Distribution>),
    /// Spacer: minimum length along the enclosing stack's axis.
    MinLength(Option<Positive>),
    // anything with text
    Text(NsStr<'a>),
    Font(Option<Font>),
    Color(Option<Color>),
    TextAlign(TextAlign),
    Selectable(Option<bool>),
    /// Maximum lines; 0 wraps without limit.
    LineLimit(Option<usize>),
    // controls
    Enabled(bool),
    ButtonKind(Option<ButtonKind>),
    Symbol(Option<NsStr<'a>>),
    /// `None` lets `ButtonKind` decide (Return for `Primary`).
    KeyEquivalent(Option<NsStr<'a>>),
    Checked(bool),
    Placeholder(Option<NsStr<'a>>),
    Editable(bool),
    Continuous(Option<bool>),
    Number(f64),
    Min(Option<f64>),
    Max(Option<f64>),
    /// Snap to multiples of this above `Min`; `None` for no snapping.
    Step(Option<Positive>),
    Items(Vec<NsStr<'a>>),
    /// The inner `None` selects nothing.
    SelectedIndex(Option<Option<usize>>),
    Indeterminate(Option<bool>),
    Running(Option<bool>),
    Spinner(Option<bool>),
    Image(ImageSource<'a>),
    Scaling(ImageScaling),
    Tint(Option<Color>),
    /// Symbol point size for `Image`; `None` for the symbol's natural size.
    SymbolSize(Option<Positive>),
    Vertical(Option<bool>),
    // scroll view
    ScrollBars {
        horizontal: Option<bool>,
        vertical: Option<bool>,
    },
    // table
    Columns(Vec<Column<'a>>),
    Rows(Box<dyn TableRows>),
    SelectedIndexes(Vec<usize>),
    Multiple(bool),
    /// `None` restores the kind's default (shown once real columns exist).
    HeaderVisible(Option<bool>),
    AlternatingRows(bool),
    /// `None` restores the system row height.
    RowHeight(Option<Positive>),
    // metal view
    /// What the drawable is cleared to before each frame; `None` is opaque black.
    ClearColor(Option<Color>),
    /// Frames per second the display timer aims for; `None` is 60.
    PreferredFps(Option<usize>),
}

/// What a view reports. Text payloads are not carried: the receiver reads the
/// current string with [`View::text`] when it wants it.
#[derive(Clone, Debug, PartialEq)]
pub enum Event {
    /// A push button was pressed.
    Action,
    /// Checkbox, radio or switch changed.
    Toggled(bool),
    TextChanged,
    /// Return was pressed in a text field.
    Submitted,
    ValueChanged(f64),
    IndexChanged(Option<usize>),
    SelectionChanged(Vec<usize>),
    /// A table row was double-clicked.
    RowActivated(usize),
    EditingBegan,
    EditingEnded,
    /// A Metal view wants a frame rendered now: [`View::render_target`] and
    /// [`View::frame_timing`] describe it until the receiver returns.
    Frame,
    /// A Metal view's drawable changed size (pixels).
    DrawableResized(Size),
}

/// Receives a view's events. Called on the main thread from inside AppKit
/// event dispatch.
pub trait ViewSink {
    /// `false` when nothing was listening for `e`; the view then applies
    /// AppKit's default for it, if there is one.
    fn event(&self, e: Event) -> bool;
}

/// What [`View`] hands each widget: the object controls use as their target
/// and text fields / tables as their delegate and data source.
pub(crate) struct Cx<'a> {
    pub(crate) target: &'a NSObject,
    pub(crate) kind: Kind,
}

/// One kind's behaviour. `view()` is the NSView the parent lays out.
pub(crate) trait Widget {
    fn view(&self) -> &NSView;

    /// Applies `prop`, or hands it back if this kind does not use it.
    fn set<'p>(&mut self, cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>>;

    /// Reads of state the user can change from the UI; everything else
    /// JavaScript already knows. `None` when this kind has no such state.
    fn text(&self) -> Option<Vec<u16>> {
        None
    }

    fn number(&self) -> Option<f64> {
        None
    }

    fn checked(&self) -> Option<bool> {
        None
    }

    /// `Some(None)`: a picker with nothing selected.
    fn selected_index(&self) -> Option<Option<usize>> {
        None
    }

    fn selected_indexes(&self) -> Option<Vec<usize>> {
        None
    }

    fn insert_child(&mut self, cx: &Cx<'_>, _child: &NSView, _index: usize) -> Result<()> {
        Err(Error::NotAContainer(cx.kind))
    }

    fn remove_child(&mut self, cx: &Cx<'_>, _child: &NSView) -> Result<()> {
        Err(Error::NotAContainer(cx.kind))
    }

    /// Reorders `child`, already in this container, to `index` (counted
    /// with `child` taken out) without it leaving the view hierarchy.
    fn move_child(&mut self, cx: &Cx<'_>, _child: &NSView, _index: usize) -> Result<()> {
        Err(Error::NotAContainer(cx.kind))
    }

    /// The control's action fired (`onAction:` on the target).
    fn on_action(&mut self, _emit: &mut dyn FnMut(Event)) {}

    /// The table/secondary action fired (`onDoubleAction:`).
    fn on_double_action(&mut self, _emit: &mut dyn FnMut(Event)) {}

    /// A delegate text notification (`controlTextDidChange:` /
    /// `textDidChange:` and friends); the widget does not learn which
    /// AppKit class sent it.
    fn on_text(&mut self, _which: TextEvent, _emit: &mut dyn FnMut(Event)) {}

    /// Table data source hooks.
    fn table_rows(&self) -> usize {
        0
    }
    fn table_cell(
        &self,
        _table: &NSTableView,
        _column: Option<&NSTableColumn>,
        _row: usize,
    ) -> Option<NSView> {
        None
    }
    fn on_selection(&mut self, _emit: &mut dyn FnMut(Event)) {}
    /// Answers the data source again after a query was refused during a
    /// borrow, and re-applies whatever depended on that answer.
    fn reload(&self) {}

    /// `MTKViewDelegate` hooks: the view is drawing a frame / its drawable
    /// is about to change size.
    fn on_frame(&mut self, _emit: &mut dyn FnMut(Event)) {}
    fn on_drawable_resized(&mut self, _size: Size, _emit: &mut dyn FnMut(Event)) {}

    /// The Metal view behind this widget, if it is one.
    fn metal(&self) -> Option<&metal::MetalView> {
        None
    }

    /// Programmatic activation for tests: `performClick:` on the kinds a
    /// user clicks. `false` when this kind has nothing to click.
    fn click(&self) -> bool {
        false
    }

    /// Re-derives the per-child layout that follows `grow`: share
    /// constraints in a stack, holding priorities in a split view.
    /// `children` are the current children, in no particular order, with
    /// their weights (see [`View::grow_weight`]).
    fn regrow(&mut self, _children: &[(NSView, f64)]) {}

    /// How many containers now enclose this view: told when it or an
    /// ancestor joins or leaves one. A stack weakens its fill constraints
    /// by that much so an outer stack's fill beats an inner one's.
    fn nested(&mut self, _depth: usize) {}

    /// The axis children are laid out along, if this container has one.
    fn axis(&self) -> Option<Orientation> {
        None
    }

    /// Children of this container must hold their size loosely (a split
    /// view's divider moves them).
    fn holds_children_loosely(&self) -> bool {
        false
    }

    /// The enclosing container's main axis: told on insertion, again if a
    /// prop turns the container, and `None` on removal.
    fn attached(&mut self, _axis: Option<Orientation>) {}

    /// Setting `prop` rewrites the view's own hugging/compression
    /// priorities, so `grow`/`loose` must be lifted around it and re-derived.
    fn rewrites_own_priorities(&self, _prop: &Prop<'_>) -> bool {
        false
    }

    /// Clear targets/delegates that point at the view's target before it
    /// goes away.
    fn detach(&mut self) {}
}

#[derive(Clone, Copy)]
pub(crate) enum TextEvent {
    Changed,
    Began,
    Ended,
}

/// One axis's size props as last requested, plus the constraints that
/// realise them (kept so a later assignment edits the constant instead of
/// stacking a second constraint). Props arrive one at a time and in any
/// order, so conflicts are settled here rather than left to Auto Layout:
/// `min` wins over `max`, and the exact length is clamped between them.
#[derive(Default)]
struct AxisSize {
    exact: Option<f64>,
    min: Option<f64>,
    max: Option<f64>,
    exact_constraint: Option<NSLayoutConstraint>,
    min_constraint: Option<NSLayoutConstraint>,
    max_constraint: Option<NSLayoutConstraint>,
}

impl AxisSize {
    fn apply(&mut self, view: &NSView, attr: Attr) {
        let min = self.min.map(|v| v.max(0.0));
        let floor = min.unwrap_or(0.0);
        let max = self.max.map(|v| v.max(floor));
        let exact = self.exact.map(|v| {
            let v = v.max(floor);
            max.map_or(v, |max| v.min(max))
        });
        let p = priority::ALMOST_REQUIRED;
        size_constraint(
            view,
            &mut self.min_constraint,
            attr,
            Rel::GreaterOrEqual,
            min,
            p,
        );
        size_constraint(
            view,
            &mut self.max_constraint,
            attr,
            Rel::LessOrEqual,
            max,
            p,
        );
        size_constraint(view, &mut self.exact_constraint, attr, Rel::Equal, exact, p);
    }
}

#[derive(Default)]
struct SizeConstraints {
    width: AxisSize,
    height: AxisSize,
}

/// Layer colours as given; a layer holds a fixed `CGColor`, so both are
/// resolved together against the view's appearance whenever either is set.
#[derive(Default)]
struct Decoration {
    background: Option<Color>,
    border: Option<Color>,
}

#[derive(Clone, Copy)]
struct AxisPriorities {
    hugging: f32,
    compression: f32,
}

/// Priorities imposed on top of the widget's own: `grow` (the prop) and
/// `loose` (a parent such as SplitView whose divider must be able to move).
/// `saved` holds the widget's own values while either is in effect.
#[derive(Default)]
struct Emphasis {
    grow: f64,
    loose: bool,
    saved: Option<[AxisPriorities; 2]>,
}

/// Horizontal compression resistance for controls that draw a title: above
/// a label's (250) so plain text truncates first, below the window holding
/// its size (500) so a long title truncates instead of widening the window.
pub(crate) const TITLE_COMPRESSION: f32 = 490.0;
/// Hugging of a view with `grow`: below stock hugging (250), a stack's own
/// (249) and the window's bottom pin (240), so growers stretch first.
const GROWER_HUGGING: f32 = 200.0;
/// Share constraints between growing siblings sit above `GROWER_HUGGING`
/// so the ratio decides who stretches, and below a grower's compression
/// (249) so the ratio never squeezes one below its content.
pub(crate) const GROW_SHARE: f32 = 225.0;

/// Which widget event hook an AppKit callback maps to.
#[derive(Clone, Copy)]
enum Callback {
    Action,
    DoubleAction,
    Text(TextEvent),
    Selection,
    Frame,
    DrawableResized(Size),
}

impl Callback {
    /// The callbacks a setter can cause by itself (`setStringValue:` posts a
    /// change, `reloadData` moves the selection): inside one they report our
    /// own change back, not user input. Editing beginning or ending is the
    /// user's focus moving even when a setter (say `hidden`) provoked it.
    fn echoes_setter(self) -> bool {
        matches!(
            self,
            Callback::Action | Callback::Text(TextEvent::Changed) | Callback::Selection
        )
    }

    /// A frame is rendered inside `drawInMTKView:` or not at all; run
    /// later, it would draw into a drawable nobody presents.
    fn deferrable(self) -> bool {
        !matches!(self, Callback::Frame)
    }
}

thread_local! {
    /// How many [`Hold`]s are alive on this thread.
    static HOLDS: Cell<usize> = const { Cell::new(0) };
    /// `Inner::run` frames on the stack; each ends with a `Hold::drain`.
    static RUNS: Cell<usize> = const { Cell::new(0) };
    /// Event deliveries that arrived under a [`Hold`], oldest first.
    static HELD_EVENTS: RefCell<VecDeque<Box<dyn FnOnce()>>> =
        const { RefCell::new(VecDeque::new()) };
}

/// AppKit reports many things synchronously from inside the call that
/// caused them: removing a focused text field ends its editing, resizing a
/// window sends `windowDidResize:`, `performClick:` fires the action. The
/// receivers run JavaScript, which may call straight back into the view or
/// window whose state is halfway through changing. While a `Hold` is alive
/// on the thread such deliveries are queued instead, and the last one to
/// drop runs them, so handlers always see settled state and no `RefCell`
/// here is ever borrowed when they run.
#[must_use]
pub(crate) struct Hold;

impl Hold {
    pub(crate) fn new() -> Hold {
        HOLDS.set(HOLDS.get() + 1);
        Hold
    }

    pub(crate) fn is_held() -> bool {
        HOLDS.get() > 0
    }

    /// Runs `deliver` now, or after the outermost `Hold` if one is alive.
    pub(crate) fn deliver(deliver: impl FnOnce() + 'static) {
        if Hold::is_held() {
            Hold::queue(deliver);
        } else {
            deliver();
        }
    }

    /// Only sound while something on the stack will [`Hold::drain`]: a live
    /// `Hold`, or an [`Inner::run`] whose widget borrow caused the callback.
    fn queue(deliver: impl FnOnce() + 'static) {
        debug_assert!(
            Hold::is_held() || RUNS.get() > 0,
            "event queued with nothing on the stack to deliver it"
        );
        HELD_EVENTS.with_borrow_mut(|queue| queue.push_back(Box::new(deliver)));
    }

    /// Delivers what was queued, oldest first, unless a `Hold` is alive.
    /// A delivery that takes and drops holds of its own drains what those
    /// queued before the next one here runs, so a handler sees the events
    /// its own calls caused before anyone sees later ones.
    fn drain() {
        if Hold::is_held() {
            return;
        }
        let batch = HELD_EVENTS.with_borrow_mut(core::mem::take);
        for deliver in batch {
            deliver();
        }
    }
}

impl Drop for Hold {
    fn drop(&mut self) {
        HOLDS.set(HOLDS.get() - 1);
        Hold::drain();
    }
}

/// AppKit calls back into a view synchronously from inside the very calls a
/// widget makes while `widget` is borrowed (`performClick:` fires the action,
/// `reloadData` asks the data source, `setStringValue:` posts a change
/// notification). Every borrow for a call into AppKit goes through
/// [`WidgetBorrow`], which keeps a [`Hold`] so those callbacks wait for the
/// borrow to end; `in_setter` and `data_wanted` mark the two that need more
/// than waiting. Borrow `widget` directly only to read a field.
struct Inner {
    kind: Kind,
    widget: RefCell<Box<dyn Widget>>,
    target: Delegate<dyn ControlEvents>,
    sizes: RefCell<SizeConstraints>,
    emphasis: RefCell<Emphasis>,
    decoration: RefCell<Decoration>,
    sink: Box<dyn ViewSink>,
    has_parent: Cell<bool>,
    /// The containing view (not a window), told again when `grow` or
    /// `hidden` changes what it lays out.
    parent: RefCell<Weak<Inner>>,
    /// Told the container's axis again when a prop changes it.
    children: RefCell<Vec<Weak<Inner>>>,
    /// Containers above this view; see [`Widget::nested`].
    depth: Cell<usize>,
    /// A setter on this view is running: callbacks that echo it are dropped
    /// (see [`Callback::echoes_setter`]).
    in_setter: Cell<bool>,
    /// A data-source query was refused while `widget` was borrowed; see
    /// [`Inner::answer_data_source`].
    data_wanted: Cell<bool>,
    /// A [`View::regrow`] is queued for when the holds unwind.
    regrow_pending: Cell<bool>,
}

/// A borrow of [`Inner::widget`] for a call into AppKit. Dropping it ends
/// the borrow, re-asks a refused data-source query, and then releases its
/// [`Hold`], which delivers the callbacks AppKit fired meanwhile.
struct WidgetBorrow<'a, B> {
    inner: &'a Inner,
    /// `None` only inside `drop`, so the borrow ends before the hold does.
    widget: Option<B>,
    setter: bool,
    _hold: Hold,
}

type WidgetRef<'a> = WidgetBorrow<'a, Ref<'a, Box<dyn Widget>>>;
type WidgetMut<'a> = WidgetBorrow<'a, RefMut<'a, Box<dyn Widget>>>;

impl Inner {
    fn widget_ref(&self) -> WidgetRef<'_> {
        WidgetBorrow {
            inner: self,
            widget: Some(self.widget.borrow()),
            setter: false,
            _hold: Hold::new(),
        }
    }

    fn widget_mut(&self) -> WidgetMut<'_> {
        WidgetBorrow {
            inner: self,
            widget: Some(self.widget.borrow_mut()),
            setter: false,
            _hold: Hold::new(),
        }
    }

    /// Like [`widget_mut`](Self::widget_mut), but callbacks that echo the
    /// setter are discarded rather than delivered late.
    fn widget_for_setter(&self) -> WidgetMut<'_> {
        self.in_setter.set(true);
        WidgetBorrow {
            inner: self,
            widget: Some(self.widget.borrow_mut()),
            setter: true,
            _hold: Hold::new(),
        }
    }
}

impl<B: Deref<Target = Box<dyn Widget>>> Deref for WidgetBorrow<'_, B> {
    type Target = dyn Widget;
    fn deref(&self) -> &Self::Target {
        &***self.widget.as_ref().unwrap()
    }
}

impl<B: DerefMut<Target = Box<dyn Widget>>> DerefMut for WidgetBorrow<'_, B> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut ***self.widget.as_mut().unwrap()
    }
}

impl<B> Drop for WidgetBorrow<'_, B> {
    fn drop(&mut self) {
        self.widget = None;
        if self.setter {
            self.inner.in_setter.set(false);
        }
        self.inner.answer_data_source();
    }
}

/// A native view. See the module docs.
pub struct View {
    inner: Rc<Inner>,
}

/// A non-owning handle for a parent that must not keep the view alive.
pub(crate) struct WeakView(Weak<Inner>);

impl WeakView {
    pub(crate) fn upgrade(&self) -> Option<View> {
        self.0.upgrade().map(|inner| View { inner })
    }
}

pub(crate) use crate::objc::appkit::{
    LayoutAttribute as Attr, LayoutRelation as Rel, Orientation, priority,
};

thread_local! {
    static LIVE_VIEWS: Cell<usize> = const { Cell::new(0) };
}

/// Number of [`View`]s currently alive on this thread (for leak tests).
pub fn live_count() -> usize {
    LIVE_VIEWS.get()
}

impl View {
    /// Creates a view of `kind` with default configuration. Events go to `sink`.
    pub fn new(kind: Kind, sink: Box<dyn ViewSink>) -> Result<View> {
        crate::objc::load()?;
        let _pool = AutoreleasePool::new();
        let inner = Rc::new_cyclic(|weak: &Weak<Inner>| {
            let target = Delegate::control(Box::new(Handler {
                inner: Weak::clone(weak),
                undo: OnceCell::new(),
            }));
            let cx = Cx {
                target: target.as_nsobject(),
                kind,
            };
            let widget: Box<dyn Widget> = match kind {
                Kind::VStack | Kind::HStack => {
                    Box::new(containers::Stack::new(&cx, kind == Kind::VStack))
                }
                Kind::View => Box::new(containers::Plain::new(&cx)),
                Kind::ScrollView => Box::new(containers::Scroll::new(&cx)),
                Kind::Group => Box::new(containers::Group::new(&cx)),
                Kind::SplitView => Box::new(containers::Split::new(&cx)),
                Kind::Text => Box::new(text::Text::new(&cx)),
                Kind::Button => Box::new(button::PushButton::new(&cx)),
                Kind::Checkbox => Box::new(button::Toggle::checkbox(&cx)),
                Kind::Radio => Box::new(button::Toggle::radio(&cx)),
                Kind::Switch => Box::new(button::Switch::new(&cx)),
                Kind::TextField => {
                    Box::new(text_field::TextField::new(&cx, text_field::Style::Plain))
                }
                Kind::SecureField => {
                    Box::new(text_field::TextField::new(&cx, text_field::Style::Secure))
                }
                Kind::SearchField => {
                    Box::new(text_field::TextField::new(&cx, text_field::Style::Search))
                }
                Kind::TextEditor => Box::new(text_editor::TextEditor::new(&cx)),
                Kind::Slider => Box::new(slider::Slider::new(&cx)),
                Kind::Picker => Box::new(picker::Picker::new(&cx)),
                Kind::Segmented => Box::new(picker::Segmented::new(&cx)),
                Kind::Progress => Box::new(progress::Progress::new(&cx)),
                Kind::Image => Box::new(image::Image::new(&cx)),
                Kind::Divider => Box::new(misc::Divider::new(&cx)),
                Kind::Spacer => Box::new(misc::Spacer::new(&cx)),
                Kind::Table => Box::new(table::Table::new(&cx)),
                Kind::MetalView => {
                    let frames = Box::new(Handler {
                        inner: Weak::clone(weak),
                        undo: OnceCell::new(),
                    });
                    Box::new(metal::MetalView::new(&cx, frames))
                }
            };
            widget.view().set_translates_autoresizing_mask(false);
            Inner {
                kind,
                widget: RefCell::new(widget),
                target,
                sizes: RefCell::default(),
                emphasis: RefCell::default(),
                decoration: RefCell::default(),
                sink,
                has_parent: Cell::new(false),
                parent: RefCell::new(Weak::new()),
                children: RefCell::default(),
                depth: Cell::new(0),
                in_setter: Cell::new(false),
                data_wanted: Cell::new(false),
                regrow_pending: Cell::new(false),
            }
        });
        LIVE_VIEWS.set(LIVE_VIEWS.get() + 1);
        Ok(View { inner })
    }

    #[inline]
    pub fn kind(&self) -> Kind {
        self.inner.kind
    }

    /// The `NSView` a parent should add.
    pub(crate) fn nsview(&self) -> NSView {
        self.inner.widget.borrow().view().clone()
    }

    /// The widget's outer `NSView` (for ScrollView and Table, the
    /// `NSScrollView`), for scripts that message it directly.
    pub fn ns_view_object(&self) -> crate::DynObject {
        crate::DynObject::from_object(&self.nsview())
    }

    pub(crate) fn downgrade(&self) -> WeakView {
        WeakView(Rc::downgrade(&self.inner))
    }

    pub fn has_parent(&self) -> bool {
        self.inner.has_parent.get()
    }

    pub(crate) fn set_has_parent(&self, has_parent: bool) {
        self.inner.has_parent.set(has_parent);
    }

    /// Applies one property.
    pub fn set(&self, prop: Prop<'_>) -> Result<()> {
        let inner = &*self.inner;
        let _hold = Hold::new();
        let _pool = AutoreleasePool::new();
        let cx = Cx {
            target: inner.target.as_nsobject(),
            kind: inner.kind,
        };
        let regrows_parent = matches!(prop, Prop::Grow(_) | Prop::Hidden(_));
        let mut widget = inner.widget_for_setter();
        let axis_before = widget.axis();
        let reprioritizes = widget.rewrites_own_priorities(&prop);
        if reprioritizes {
            restore_own_priorities(widget.view(), &mut inner.emphasis.borrow_mut());
        }
        let result = match widget.set(&cx, prop) {
            Ok(None) => Ok(()),
            Ok(Some(prop)) => self.set_common(widget.view(), prop),
            Err(e) => Err(e),
        };
        if reprioritizes {
            sync_emphasis(widget.view(), &mut inner.emphasis.borrow_mut());
        }
        let axis = widget.axis();
        drop(widget);
        if axis != axis_before {
            for child in self.children() {
                child.attached(axis);
            }
        }
        if regrows_parent
            && result.is_ok()
            && let Some(parent) = self.parent()
        {
            parent.regrow();
        }
        result
    }

    fn children(&self) -> Vec<View> {
        self.inner
            .children
            .borrow()
            .iter()
            .filter_map(|weak| weak.upgrade().map(|inner| View { inner }))
            .collect()
    }

    fn parent(&self) -> Option<View> {
        self.inner
            .parent
            .borrow()
            .upgrade()
            .map(|inner| View { inner })
    }

    /// Tells the widget its container's axis. A widget may set its own
    /// priorities again for the new axis (a `Divider` turns), so `grow` and
    /// `loose` are lifted around the call and derived afresh.
    fn attached(&self, axis: Option<Orientation>) {
        let view = self.nsview();
        restore_own_priorities(&view, &mut self.inner.emphasis.borrow_mut());
        self.inner.widget_mut().attached(axis);
        sync_emphasis(&view, &mut self.inner.emphasis.borrow_mut());
    }

    /// [`regrow`](View::regrow) once when the outermost [`Hold`] unwinds,
    /// however many children asked.
    fn regrow_later(&self) {
        if self.inner.regrow_pending.replace(true) {
            return;
        }
        let weak = Rc::downgrade(&self.inner);
        Hold::queue(move || {
            if let Some(inner) = weak.upgrade() {
                inner.regrow_pending.set(false);
                View { inner }.regrow();
            }
        });
    }

    /// Hands the container widget every child's grow weight again.
    fn regrow(&self) {
        let children: Vec<(NSView, f64)> = self
            .children()
            .iter()
            .map(|child| (child.nsview(), child.grow_weight()))
            .collect();
        self.inner.widget_mut().regrow(&children);
    }

    /// Records this view's container depth and renumbers everything below it.
    fn nest(&self, depth: usize) {
        if self.inner.depth.replace(depth) == depth {
            return;
        }
        self.inner.widget_mut().nested(depth);
        for child in self.children() {
            child.nest(depth + 1);
        }
    }

    /// `grow`, except that a `Spacer` left at 0 counts as 1: taking up
    /// leftover space is what it is for, and two of them should share it.
    fn grow_weight(&self) -> f64 {
        let grow = self.inner.emphasis.borrow().grow;
        if grow == 0.0 && self.kind() == Kind::Spacer {
            1.0
        } else {
            grow
        }
    }

    /// A text input's current text; `None` for other kinds.
    pub fn text(&self) -> Option<Vec<u16>> {
        let _pool = AutoreleasePool::new();
        self.inner.widget_ref().text()
    }

    /// A slider's current value; `None` for other kinds.
    pub fn number(&self) -> Option<f64> {
        let _pool = AutoreleasePool::new();
        self.inner.widget_ref().number()
    }

    /// Whether a checkbox, radio or switch is on; `None` for other kinds.
    pub fn checked(&self) -> Option<bool> {
        let _pool = AutoreleasePool::new();
        self.inner.widget_ref().checked()
    }

    /// A picker's or segmented control's selection (`Some(None)` when nothing
    /// is selected); `None` for other kinds.
    pub fn selected_index(&self) -> Option<Option<usize>> {
        let _pool = AutoreleasePool::new();
        self.inner.widget_ref().selected_index()
    }

    /// A table's selected rows; `None` for other kinds.
    pub fn selected_indexes(&self) -> Option<Vec<usize>> {
        let _pool = AutoreleasePool::new();
        self.inner.widget_ref().selected_indexes()
    }

    /// Inserts `child` at `index` among this container's children, or, when
    /// it is already one of them, moves it there (`index` then counts the
    /// children without it). A move keeps keyboard focus inside `child`.
    pub fn insert_child(&self, child: &View, index: usize) -> Result<()> {
        if Rc::ptr_eq(&self.inner, &child.inner) {
            return Err(Error::WouldCycle);
        }
        let moving = child
            .parent()
            .is_some_and(|parent| Rc::ptr_eq(&parent.inner, &self.inner));
        if child.has_parent() && !moving {
            return Err(Error::ChildHasParent);
        }
        let _hold = Hold::new();
        let _pool = AutoreleasePool::new();
        let child_view = child.nsview();
        let kind = self.kind();
        let cx = Cx {
            target: self.inner.target.as_nsobject(),
            kind,
        };
        if moving {
            self.inner
                .widget_mut()
                .move_child(&cx, &child_view, index)?;
            self.regrow();
            return Ok(());
        }
        if self.nsview().is_descendant_of(&child_view) {
            return Err(Error::WouldCycle);
        }
        let (result, axis, loose) = {
            let mut parent = self.inner.widget_mut();
            let result = parent.insert_child(&cx, &child_view, index);
            (result, parent.axis(), parent.holds_children_loosely())
        };
        result?;
        self.inner
            .children
            .borrow_mut()
            .push(Rc::downgrade(&child.inner));
        *child.inner.parent.borrow_mut() = Rc::downgrade(&self.inner);
        child.inner.has_parent.set(true);
        child.inner.emphasis.borrow_mut().loose = loose;
        child.attached(axis);
        child.nest(self.inner.depth.get() + 1);
        self.regrow();
        Ok(())
    }

    pub fn remove_child(&self, child: &View) -> Result<()> {
        let _hold = Hold::new();
        let _pool = AutoreleasePool::new();
        let child_view = child.nsview();
        let cx = Cx {
            target: self.inner.target.as_nsobject(),
            kind: self.inner.kind,
        };
        self.inner.widget_mut().remove_child(&cx, &child_view)?;
        self.inner.children.borrow_mut().retain(|weak| {
            weak.upgrade()
                .is_some_and(|other| !Rc::ptr_eq(&other, &child.inner))
        });
        *child.inner.parent.borrow_mut() = Weak::new();
        child.inner.has_parent.set(false);
        child.inner.emphasis.borrow_mut().loose = false;
        child.attached(None);
        child.nest(0);
        self.regrow();
        Ok(())
    }

    /// Detaches from a parent that keeps no per-child state (window content):
    /// removes the NSView from its superview and clears `has_parent`.
    pub(crate) fn detach_from_parent(&self) {
        let _hold = Hold::new();
        self.nsview().remove_from_superview();
        self.inner.has_parent.set(false);
    }

    /// Frame in the superview's coordinates once the view is in a window,
    /// with that window's pending layout run first so the answer reflects
    /// every change made so far; all zeros while it is not in one. Callbacks
    /// the layout pass provokes (a window `did_resize`) go out after this
    /// returns.
    pub fn frame(&self) -> Rect {
        let _hold = Hold::new();
        let _pool = AutoreleasePool::new();
        let view = self.nsview();
        match view.window() {
            Some(window) => {
                window.layout_if_needed();
                view.frame()
            }
            None => Rect::default(),
        }
    }

    /// Simulates the user activating the control.
    pub fn click(&self) -> Result<()> {
        let _pool = AutoreleasePool::new();
        if self.inner.widget_ref().click() {
            Ok(())
        } else {
            Err(Error::Unsupported(
                "click() only applies to a Button, Checkbox, Radio or Switch",
            ))
        }
    }

    /// Props every kind understands.
    fn set_common(&self, view: &NSView, prop: Prop<'_>) -> Result<()> {
        let inner = &*self.inner;
        match prop {
            Prop::Hidden(v) => view.set_hidden(v),
            Prop::Alpha(v) => view.set_alpha_value(v.clamp(0.0, 1.0)),
            Prop::Tooltip(v) => view.set_tool_tip(v.map(NSString::from_str).as_ref()),
            Prop::Identifier(v) => view.set_identifier(v.map(NSString::from_str).as_ref()),
            Prop::Width(v) => {
                let mut sizes = inner.sizes.borrow_mut();
                sizes.width.exact = v;
                sizes.width.apply(view, Attr::Width);
            }
            Prop::MinWidth(v) => {
                let mut sizes = inner.sizes.borrow_mut();
                sizes.width.min = v;
                sizes.width.apply(view, Attr::Width);
            }
            Prop::MaxWidth(v) => {
                let mut sizes = inner.sizes.borrow_mut();
                sizes.width.max = v;
                sizes.width.apply(view, Attr::Width);
            }
            Prop::Height(v) => {
                let mut sizes = inner.sizes.borrow_mut();
                sizes.height.exact = v;
                sizes.height.apply(view, Attr::Height);
            }
            Prop::MinHeight(v) => {
                let mut sizes = inner.sizes.borrow_mut();
                sizes.height.min = v;
                sizes.height.apply(view, Attr::Height);
            }
            Prop::MaxHeight(v) => {
                let mut sizes = inner.sizes.borrow_mut();
                sizes.height.max = v;
                sizes.height.apply(view, Attr::Height);
            }
            Prop::Grow(v) => {
                let mut emphasis = inner.emphasis.borrow_mut();
                emphasis.grow = v.max(0.0);
                sync_emphasis(view, &mut emphasis);
            }
            Prop::Background(color) => {
                view.set_wants_layer(true);
                let mut decoration = inner.decoration.borrow_mut();
                decoration.background = color;
                decoration.paint(view);
            }
            Prop::CornerRadius(r) => {
                view.set_wants_layer(true);
                if let Some(layer) = view.layer() {
                    layer.set_corner_radius(r.max(0.0));
                    layer.set_masks_to_bounds(r > 0.0);
                }
            }
            Prop::Border { width, color } => {
                view.set_wants_layer(true);
                if let Some(layer) = view.layer() {
                    layer.set_border_width(width.max(0.0));
                }
                let mut decoration = inner.decoration.borrow_mut();
                decoration.border = color;
                decoration.paint(view);
            }
            _ => return Err(Error::UnknownProp(inner.kind)),
        }
        Ok(())
    }

    /// PNG snapshot of the view as currently laid out. Callbacks the layout
    /// and display pass provoke go out after this returns.
    pub fn snapshot_png(&self) -> Option<Vec<u8>> {
        let _hold = Hold::new();
        snapshot_png(&self.nsview())
    }
}

impl Drop for Inner {
    fn drop(&mut self) {
        // Removing a focused field ends editing, which reports `Ended`/`blur`
        // synchronously; hold so that goes out after the view is gone rather
        // than from inside this drop (which may itself be a GC finalizer).
        let hold = Hold::new();
        let _pool = AutoreleasePool::new();
        let widget = self.widget.get_mut();
        widget.detach();
        // Constraints deactivate themselves when their view leaves the hierarchy.
        widget.view().remove_from_superview();
        LIVE_VIEWS.set(LIVE_VIEWS.get().saturating_sub(1));
        // A child that dies while still parented takes its `grow` share
        // constraints with it; the parent lays the surviving growers out
        // again (once, when the holds unwind) if it is itself still placed.
        if let Some(parent) = self.parent.get_mut().upgrade() {
            let me: *const Inner = self;
            parent
                .children
                .borrow_mut()
                .retain(|weak| !core::ptr::eq(weak.as_ptr(), me));
            let grower = self.emphasis.get_mut().grow > 0.0;
            let parent = View { inner: parent };
            if grower && parent.nsview().superview().is_some() {
                parent.regrow_later();
            }
        }
        drop(hold);
    }
}

impl Inner {
    /// Runs one widget hook and forwards what it emits. Only ever called
    /// with no [`Hold`] alive. Events are collected first and delivered
    /// after the widget borrow ends, because the sink runs JavaScript that
    /// may call straight back into this view.
    fn run(self: &Rc<Self>, callback: Callback) {
        let _pool = AutoreleasePool::new();
        RUNS.set(RUNS.get() + 1);
        let mut events = Vec::new();
        {
            // No `Hold` around the hook: releasing one would deliver older
            // queued events ahead of the ones this hook is about to emit.
            // Anything AppKit reports during the hook finds `widget`
            // borrowed, is queued, and goes out right after them.
            let Ok(mut widget) = self.widget.try_borrow_mut() else {
                self.defer(callback);
                RUNS.set(RUNS.get() - 1);
                return;
            };
            let emit: &mut dyn FnMut(Event) = &mut |e| events.push(e);
            match callback {
                Callback::Action => widget.on_action(emit),
                Callback::DoubleAction => widget.on_double_action(emit),
                Callback::Text(which) => widget.on_text(which, emit),
                Callback::Selection => widget.on_selection(emit),
                Callback::Frame => widget.on_frame(emit),
                Callback::DrawableResized(size) => widget.on_drawable_resized(size, emit),
            }
        }
        self.answer_data_source();
        for event in events {
            let submitted = event == Event::Submitted;
            let taken = self.sink.event(event);
            if submitted && !taken {
                self.press_default_button();
            }
        }
        RUNS.set(RUNS.get() - 1);
        Hold::drain();
    }

    /// Queues `callback` for the next [`Hold::drain`].
    fn defer(self: &Rc<Self>, callback: Callback) {
        if !callback.deferrable() {
            return;
        }
        let inner = Rc::downgrade(self);
        Hold::queue(move || {
            if let Some(inner) = inner.upgrade() {
                inner.run(callback);
            }
        });
    }

    /// NSTableView caches the empty answer a refused data-source query got
    /// while `widget` was borrowed, so once the borrow ends it is made to
    /// ask again. The reload is ours, so selection changes it causes are
    /// not user input either; its queries take a shared borrow and are
    /// answered while this one is held.
    fn answer_data_source(&self) {
        if self.data_wanted.take() {
            self.in_setter.set(true);
            self.widget.borrow().reload();
            self.in_setter.set(false);
        }
    }

    /// Return in a text field whose `Submitted` nobody listens for goes to
    /// the window's default button, as it does for an `NSTextField` with no
    /// action of its own. A text field's action also fires for a search
    /// field's cancel button; like AppKit, only a key press is passed on.
    fn press_default_button(&self) {
        /// `NSEventTypeKeyDown`
        const KEY_DOWN: usize = 10;
        let from_key = NSApplication::shared()
            .current_event()
            .is_some_and(|event| event.kind() == KEY_DOWN);
        if !from_key {
            return;
        }
        let cell = self
            .widget
            .borrow()
            .view()
            .window()
            .and_then(|window| window.default_button_cell());
        if let Some(cell) = cell {
            cell.perform_click(None);
        }
    }
}

/// The [`ControlEvents`] receiver behind each view's target object, and the
/// [`MetalViewEvents`] receiver behind a Metal view's `MTKView` delegate.
struct Handler {
    inner: Weak<Inner>,
    /// An NSTextView's own undo stack. The default is the window's shared
    /// one, where clearing a TextEditor's stale groups after a programmatic
    /// `value` would also erase every sibling's typing history. Held here,
    /// not in the widget, so the answer never depends on a `widget` borrow.
    undo: OnceCell<NSUndoManager>,
}

impl Handler {
    fn forward(&self, callback: Callback) {
        let Some(inner) = self.inner.upgrade() else {
            return;
        };
        if inner.in_setter.get() && callback.echoes_setter() {
            return;
        }
        if Hold::is_held() {
            inner.defer(callback);
        } else {
            inner.run(callback);
        }
    }
}

impl ControlEvents for Handler {
    fn action(&self) {
        self.forward(Callback::Action);
    }
    fn double_action(&self) {
        self.forward(Callback::DoubleAction);
    }
    fn text_did_change(&self) {
        self.forward(Callback::Text(TextEvent::Changed));
    }
    fn text_did_begin_editing(&self) {
        self.forward(Callback::Text(TextEvent::Began));
    }
    fn text_did_end_editing(&self) {
        self.forward(Callback::Text(TextEvent::Ended));
    }
    fn undo_manager(&self) -> Option<NSUndoManager> {
        Some(self.undo.get_or_init(NSUndoManager::new).clone())
    }

    // Data-source queries ignore `in_setter` (the reload a `WidgetBorrow`
    // issues as it ends runs under it) and holds (they run no JavaScript);
    // only a held borrow refuses them, and then its end repeats the question.
    fn number_of_rows(&self) -> usize {
        let Some(inner) = self.inner.upgrade() else {
            return 0;
        };
        let Ok(widget) = inner.widget.try_borrow() else {
            inner.data_wanted.set(true);
            return 0;
        };
        widget.table_rows()
    }
    fn view_for_row(
        &self,
        table: &NSTableView,
        column: Option<&NSTableColumn>,
        row: usize,
    ) -> Option<NSView> {
        let inner = self.inner.upgrade()?;
        let Ok(widget) = inner.widget.try_borrow() else {
            inner.data_wanted.set(true);
            return None;
        };
        widget.table_cell(table, column, row)
    }
    fn selection_did_change(&self) {
        self.forward(Callback::Selection);
    }
}

impl MetalViewEvents for Handler {
    fn draw(&self) {
        self.forward(Callback::Frame);
    }
    fn drawable_size_will_change(&self, size: Size) {
        self.forward(Callback::DrawableResized(size));
    }
}

impl Decoration {
    /// `-[NSColor CGColor]` resolves a dynamic colour against
    /// `NSAppearance.currentAppearance`, which AppKit only points at the
    /// right appearance while drawing, so it is pointed at the view's own
    /// around the conversion.
    fn paint(&self, view: &NSView) {
        let Some(layer) = view.layer() else {
            return;
        };
        let previous = NSAppearance::current_appearance();
        NSAppearance::set_current_appearance(Some(&view.effective_appearance()));
        let background = self.background.as_ref().map(Color::to_nscolor);
        layer.set_background_color(background.as_ref().map(NSColor::cg_color));
        let border = self.border.as_ref().map(Color::to_nscolor);
        layer.set_border_color(border.as_ref().map(NSColor::cg_color));
        NSAppearance::set_current_appearance(Some(&previous));
    }
}

/// Derives `view`'s hugging and compression priorities from its own values
/// plus `e`, and puts its own values back once neither `grow` nor `loose`
/// applies.
fn sync_emphasis(view: &NSView, e: &mut Emphasis) {
    let active = e.grow > 0.0 || e.loose;
    if !active {
        restore_own_priorities(view, e);
        return;
    }
    let saved = *e.saved.get_or_insert_with(|| {
        Orientation::BOTH.map(|axis| AxisPriorities {
            hugging: view.content_hugging_priority(axis),
            compression: view.content_compression_resistance_priority(axis),
        })
    });
    for (axis, own) in Orientation::BOTH.into_iter().zip(saved) {
        // Growers stretch and squeeze before anything at stock priorities;
        // how much each takes among siblings is the container's `regrow`.
        // Loose panes only need to sit below NSStackView's filler.
        let (hugging, compression) = if e.grow > 0.0 {
            (GROWER_HUGGING, priority::BELOW_STACK_FILLER)
        } else {
            (
                own.hugging.min(priority::BELOW_STACK_FILLER),
                own.compression,
            )
        };
        set_hugging(view, hugging, axis);
        view.set_content_compression_resistance_priority(compression, axis);
    }
}

/// Writes the widget's own priorities back and forgets the snapshot, so the
/// next `sync_emphasis` re-reads whatever the widget sets in between.
fn restore_own_priorities(view: &NSView, e: &mut Emphasis) {
    if let Some(saved) = e.saved.take() {
        for (axis, own) in Orientation::BOTH.into_iter().zip(saved) {
            set_hugging(view, own.hugging, axis);
            view.set_content_compression_resistance_priority(own.compression, axis);
        }
    }
}

/// A stack view has no content of its own for `contentHuggingPriority` to
/// hold on to; how tightly it wraps its children is a separate priority,
/// kept equal to it (see `Stack::new`).
fn set_hugging(view: &NSView, hugging: f32, axis: Orientation) {
    view.set_content_hugging_priority(hugging, axis);
    if let Ok(stack) = view.clone().downcast::<NSStackView>() {
        stack.set_hugging_priority(hugging, axis);
    }
}

/// Keeps `slot` holding one active `view.attr rel value` constraint, or
/// none when `value` is `None`.
pub(crate) fn size_constraint(
    view: &NSView,
    slot: &mut Option<NSLayoutConstraint>,
    attr: Attr,
    rel: Rel,
    value: Option<f64>,
    priority: f32,
) {
    match (value, slot.as_ref()) {
        (None, None) => {}
        (None, Some(c)) => {
            c.set_active(false);
            *slot = None;
        }
        (Some(v), Some(c)) => c.set_constant(v),
        (Some(v), None) => {
            let c =
                NSLayoutConstraint::with_items(view, attr, rel, None, Attr::NotAnAttribute, 1.0, v);
            c.set_priority(priority);
            c.set_active(true);
            *slot = Some(c);
        }
    }
}

/// PNG bytes for `view` drawn at its current size, or None if it has none.
pub(crate) fn snapshot_png(view: &NSView) -> Option<Vec<u8>> {
    let _pool = AutoreleasePool::new();
    view.layout_subtree_if_needed();
    let bounds = view.bounds();
    if bounds.size.width <= 0.0 || bounds.size.height <= 0.0 {
        return None;
    }
    let rep = view.bitmap_image_rep_for_caching_display_in_rect(bounds)?;
    view.cache_display_in_rect(bounds, &rep);
    Some(rep.representation(BitmapImageFileType::Png, None)?.to_vec())
}

/// Wires `control`'s target/action to the view's target. The control does
/// not retain its target; `Widget::detach` must clear it again.
pub(crate) fn wire_action(cx: &Cx<'_>, control: &NSControl) {
    control.set_target(Some(cx.target));
    control.set_action(Some(sel!("onAction:")));
}

pub(crate) fn unwire_action(control: &NSControl) {
    control.set_target(None);
    control.set_action(None);
}

/// `-[NSControl setFont:]` from an optional [`Font`] (None = system default).
pub(crate) fn apply_font(control: &NSControl, font: Option<Font>) {
    control.set_font(Some(&font.unwrap_or_default().to_nsfont()));
}
