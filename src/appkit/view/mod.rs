//! Views: one Rust object per AppKit view, addressed by [`Kind`], configured
//! through typed [`Prop`]s and reporting back through [`ViewSink`].
//!
//! Every kind lives in its own module behind the [`Widget`] trait. [`View`]
//! owns the widget plus what all kinds share: size constraints, layer-backed
//! decoration, and the target/delegate object AppKit calls into.

use core::cell::{Cell, OnceCell, Ref, RefCell, RefMut};
use core::ops::{Deref, DerefMut};
use std::rc::{Rc, Weak};

use crate::color::Color;
use crate::error::{Error, Result};
use crate::font::Font;
use crate::geometry::{Insets, Positive, Rect};
use crate::named_enum;
use crate::objc::appkit::{
    BitmapImageFileType, NSColor, NSControl, NSLayoutConstraint, NSTableColumn, NSTableView,
    NSUndoManager, NSView, StackDistribution, TextAlignment,
};
use crate::objc::foundation::{NSObject, NSString};
use crate::objc::{self, AutoreleasePool, CGColorRef, ControlEvents, Delegate, NsStr, Object, sel};

mod button;
mod containers;
mod image;
mod misc;
mod picker;
mod progress;
mod slider;
mod table;
mod text;
mod text_editor;
mod text_field;

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
    Rows(Vec<Vec<NsStr<'a>>>),
    SelectedIndexes(Vec<usize>),
    Multiple(bool),
    /// `None` restores the kind's default (shown once real columns exist).
    HeaderVisible(Option<bool>),
    AlternatingRows(bool),
    /// `None` restores the system row height.
    RowHeight(Option<Positive>),
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
}

/// Receives a view's events. Called on the main thread from inside AppKit
/// event dispatch.
pub trait ViewSink {
    fn event(&self, e: Event);
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

    /// Programmatic activation for tests (`performClick:` on controls).
    fn click(&self) {
        if let Ok(control) = self.view().clone().downcast::<NSControl>() {
            control.perform_click(None);
        }
    }

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

/// Owned constraints for the size props, so a later assignment edits the
/// constant instead of stacking a second constraint.
#[derive(Default)]
struct SizeConstraints {
    width: Option<NSLayoutConstraint>,
    height: Option<NSLayoutConstraint>,
    min_width: Option<NSLayoutConstraint>,
    max_width: Option<NSLayoutConstraint>,
    min_height: Option<NSLayoutConstraint>,
    max_height: Option<NSLayoutConstraint>,
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

/// Which widget event hook an AppKit callback maps to.
#[derive(Clone, Copy)]
enum Callback {
    Action,
    DoubleAction,
    Text(TextEvent),
    Selection,
}

/// AppKit calls back into a view synchronously from inside the very calls a
/// widget makes while `widget` is borrowed (`performClick:` fires the action,
/// `reloadData` asks the data source, `setStringValue:` posts a change
/// notification). `in_setter`, `pending` and `data_wanted` are how those
/// re-entrant calls are told apart, and [`WidgetBorrow`] answers them once
/// the borrow ends. Borrow `widget` directly only for getters that make no
/// AppKit call.
struct Inner {
    kind: Kind,
    widget: RefCell<Box<dyn Widget>>,
    target: Delegate<dyn ControlEvents>,
    sizes: RefCell<SizeConstraints>,
    emphasis: RefCell<Emphasis>,
    sink: Box<dyn ViewSink>,
    has_parent: Cell<bool>,
    /// Told the container's axis again when a prop changes it.
    children: RefCell<Vec<Weak<Inner>>>,
    /// Event callbacks during a setter echo our own change, not user input,
    /// and are dropped.
    in_setter: Cell<bool>,
    /// Event callbacks that arrived while `widget` was borrowed outside a
    /// setter; replayed by `settle`.
    pending: RefCell<Vec<Callback>>,
    /// A data-source query was refused while `widget` was borrowed.
    /// NSTableView caches that empty answer, so `settle` makes it ask again.
    data_wanted: Cell<bool>,
}

/// A borrow of [`Inner::widget`] for a call into AppKit. Dropping it ends
/// the borrow first and then settles: callbacks AppKit fired meanwhile are
/// replayed (or, for a setter, were our own echo and were dropped) and a
/// refused data-source query is asked again.
struct WidgetBorrow<'a, B> {
    inner: &'a Inner,
    /// `None` only inside `drop`, so the borrow can end before `settle`.
    widget: Option<B>,
    setter: bool,
}

type WidgetRef<'a> = WidgetBorrow<'a, Ref<'a, Box<dyn Widget>>>;
type WidgetMut<'a> = WidgetBorrow<'a, RefMut<'a, Box<dyn Widget>>>;

impl Inner {
    fn widget_ref(&self) -> WidgetRef<'_> {
        WidgetBorrow {
            inner: self,
            widget: Some(self.widget.borrow()),
            setter: false,
        }
    }

    fn widget_mut(&self) -> WidgetMut<'_> {
        WidgetBorrow {
            inner: self,
            widget: Some(self.widget.borrow_mut()),
            setter: false,
        }
    }

    /// Like [`widget_mut`](Self::widget_mut), but event callbacks fired
    /// until it drops echo our own change and are discarded, not replayed.
    fn widget_for_setter(&self) -> WidgetMut<'_> {
        self.in_setter.set(true);
        WidgetBorrow {
            inner: self,
            widget: Some(self.widget.borrow_mut()),
            setter: true,
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
        self.inner.settle();
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
            };
            widget.view().set_translates_autoresizing_mask(false);
            Inner {
                kind,
                widget: RefCell::new(widget),
                target,
                sizes: RefCell::default(),
                emphasis: RefCell::default(),
                sink,
                has_parent: Cell::new(false),
                children: RefCell::default(),
                in_setter: Cell::new(false),
                pending: RefCell::default(),
                data_wanted: Cell::new(false),
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
        let _pool = AutoreleasePool::new();
        let cx = Cx {
            target: inner.target.as_nsobject(),
            kind: inner.kind,
        };
        let mut widget = inner.widget_for_setter();
        let axis_before = widget.axis();
        let reprioritizes = widget.rewrites_own_priorities(&prop);
        if reprioritizes {
            restore_own_priorities(widget.view(), &mut inner.emphasis.borrow_mut());
        }
        let result = match widget.set(&cx, prop) {
            Ok(None) => Ok(()),
            Ok(Some(prop)) => set_common(
                inner.kind,
                widget.view(),
                &mut inner.sizes.borrow_mut(),
                &mut inner.emphasis.borrow_mut(),
                prop,
            ),
            Err(e) => Err(e),
        };
        if reprioritizes {
            sync_emphasis(widget.view(), &mut inner.emphasis.borrow_mut());
        }
        let axis = widget.axis();
        drop(widget);
        if axis != axis_before {
            for child in self.children() {
                child.inner.widget_mut().attached(axis);
            }
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

    /// A text input's current text; `None` for other kinds.
    pub fn text(&self) -> Option<Vec<u16>> {
        let _pool = AutoreleasePool::new();
        self.inner.widget.borrow().text()
    }

    /// A slider's current value; `None` for other kinds.
    pub fn number(&self) -> Option<f64> {
        let _pool = AutoreleasePool::new();
        self.inner.widget.borrow().number()
    }

    /// Whether a checkbox, radio or switch is on; `None` for other kinds.
    pub fn checked(&self) -> Option<bool> {
        let _pool = AutoreleasePool::new();
        self.inner.widget.borrow().checked()
    }

    /// A picker's or segmented control's selection (`Some(None)` when nothing
    /// is selected); `None` for other kinds.
    pub fn selected_index(&self) -> Option<Option<usize>> {
        let _pool = AutoreleasePool::new();
        self.inner.widget.borrow().selected_index()
    }

    /// A table's selected rows; `None` for other kinds.
    pub fn selected_indexes(&self) -> Option<Vec<usize>> {
        let _pool = AutoreleasePool::new();
        self.inner.widget.borrow().selected_indexes()
    }

    /// Inserts `child` at `index` among this container's children.
    pub fn insert_child(&self, child: &View, index: usize) -> Result<()> {
        if Rc::ptr_eq(&self.inner, &child.inner) {
            return Err(Error::WouldCycle);
        }
        if child.has_parent() {
            return Err(Error::ChildHasParent);
        }
        let _pool = AutoreleasePool::new();
        let child_view = child.nsview();
        if self.nsview().is_descendant_of(&child_view) {
            return Err(Error::WouldCycle);
        }
        let kind = self.kind();
        let cx = Cx {
            target: self.inner.target.as_nsobject(),
            kind,
        };
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
        {
            let mut emphasis = child.inner.emphasis.borrow_mut();
            emphasis.loose = loose;
            sync_emphasis(&child_view, &mut emphasis);
        }
        child.inner.has_parent.set(true);
        child.inner.widget_mut().attached(axis);
        Ok(())
    }

    pub fn remove_child(&self, child: &View) -> Result<()> {
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
        {
            let mut emphasis = child.inner.emphasis.borrow_mut();
            emphasis.loose = false;
            sync_emphasis(&child_view, &mut emphasis);
        }
        child.inner.has_parent.set(false);
        child.inner.widget_mut().attached(None);
        Ok(())
    }

    /// Detaches from a parent that keeps no per-child state (window content):
    /// removes the NSView from its superview and clears `has_parent`.
    pub(crate) fn detach_from_parent(&self) {
        self.nsview().remove_from_superview();
        self.inner.has_parent.set(false);
    }

    /// Frame in the superview's coordinates after layout.
    pub fn frame(&self) -> Rect {
        self.inner.widget.borrow().view().frame()
    }

    /// Simulates the user activating the control.
    pub fn click(&self) {
        let _pool = AutoreleasePool::new();
        self.inner.widget_ref().click();
    }

    /// PNG snapshot of the view as currently laid out.
    pub fn snapshot_png(&self) -> Option<Vec<u8>> {
        snapshot_png(&self.nsview())
    }
}

impl Drop for Inner {
    fn drop(&mut self) {
        let _pool = AutoreleasePool::new();
        let widget = self.widget.get_mut();
        widget.detach();
        // Constraints deactivate themselves when their view leaves the hierarchy.
        widget.view().remove_from_superview();
        LIVE_VIEWS.set(LIVE_VIEWS.get().saturating_sub(1));
    }
}

impl Inner {
    /// Runs one widget hook and forwards what it emits. Events are collected
    /// first and delivered after the widget borrow ends, because the sink
    /// runs JavaScript that may call straight back into this view.
    fn run(&self, callback: Callback) {
        let mut events = Vec::new();
        {
            let Ok(mut widget) = self.widget.try_borrow_mut() else {
                self.pending.borrow_mut().push(callback);
                return;
            };
            let emit: &mut dyn FnMut(Event) = &mut |e| events.push(e);
            match callback {
                Callback::Action => widget.on_action(emit),
                Callback::DoubleAction => widget.on_double_action(emit),
                Callback::Text(which) => widget.on_text(which, emit),
                Callback::Selection => widget.on_selection(emit),
            }
        }
        for event in events {
            self.sink.event(event);
        }
    }

    /// Only called by [`WidgetBorrow`]'s `drop`, right after the borrow of
    /// `widget` ends: replays event callbacks that arrived meanwhile and
    /// re-asks a refused data source.
    fn settle(&self) {
        loop {
            let batch = core::mem::take(&mut *self.pending.borrow_mut());
            if batch.is_empty() {
                break;
            }
            for callback in batch {
                self.run(callback);
            }
        }
        if self.data_wanted.take() {
            // The reload is ours, so selection changes it causes are not
            // user input either. Data-source queries take a shared borrow,
            // so they are answered while this one is held.
            self.in_setter.set(true);
            self.widget.borrow().reload();
            self.in_setter.set(false);
        }
    }
}

/// The [`ControlEvents`] receiver behind each view's target object.
struct Handler {
    inner: Weak<Inner>,
    /// An NSTextView's own undo stack. The default is the window's shared
    /// one, where clearing a TextEditor's stale groups after a programmatic
    /// `value` would also erase every sibling's typing history. Held here,
    /// not in the widget, so the answer never depends on a `widget` borrow.
    undo: OnceCell<NSUndoManager>,
}

impl Handler {
    /// The view, for an event callback: not while a setter is echoing.
    fn for_event(&self) -> Option<Rc<Inner>> {
        self.inner.upgrade().filter(|inner| !inner.in_setter.get())
    }

    fn forward(&self, callback: Callback) {
        if let Some(inner) = self.for_event() {
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

    // Data-source queries ignore `in_setter` (the reload `settle` issues runs
    // under it); only a held borrow refuses them, and then `settle` repeats
    // the question.
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

/// Props every kind understands.
fn set_common(
    kind: Kind,
    view: &NSView,
    sizes: &mut SizeConstraints,
    emphasis: &mut Emphasis,
    prop: Prop<'_>,
) -> Result<()> {
    match prop {
        Prop::Hidden(v) => view.set_hidden(v),
        Prop::Alpha(v) => view.set_alpha_value(v.clamp(0.0, 1.0)),
        Prop::Tooltip(v) => view.set_tool_tip(v.map(NSString::from_str).as_ref()),
        Prop::Identifier(v) => view.set_identifier(v.map(NSString::from_str).as_ref()),
        Prop::Width(v) => size_constraint(view, &mut sizes.width, Attr::Width, Rel::Equal, v),
        Prop::Height(v) => size_constraint(view, &mut sizes.height, Attr::Height, Rel::Equal, v),
        Prop::MinWidth(v) => size_constraint(
            view,
            &mut sizes.min_width,
            Attr::Width,
            Rel::GreaterOrEqual,
            v,
        ),
        Prop::MaxWidth(v) => {
            size_constraint(view, &mut sizes.max_width, Attr::Width, Rel::LessOrEqual, v)
        }
        Prop::MinHeight(v) => size_constraint(
            view,
            &mut sizes.min_height,
            Attr::Height,
            Rel::GreaterOrEqual,
            v,
        ),
        Prop::MaxHeight(v) => size_constraint(
            view,
            &mut sizes.max_height,
            Attr::Height,
            Rel::LessOrEqual,
            v,
        ),
        Prop::Grow(v) => {
            emphasis.grow = v.max(0.0);
            sync_emphasis(view, emphasis);
        }
        Prop::Background(color) => {
            view.set_wants_layer(true);
            if let Some(layer) = view.layer() {
                let ns = color.map(|c| c.to_nscolor());
                layer.set_background_color(cg_color(ns.as_ref()));
            }
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
                let ns = color.map(|c| c.to_nscolor());
                layer.set_border_color(cg_color(ns.as_ref()));
            }
        }
        _ => return Err(Error::UnknownProp(kind)),
    }
    Ok(())
}

fn cg_color(color: Option<&NSColor>) -> Option<CGColorRef<'_>> {
    color.map(NSColor::cg_color)
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
        // Lower hugging stretches sooner; growers and loose panes must sit
        // below NSStackView's filler.
        let (hugging, compression) = if e.grow > 0.0 {
            (
                (priority::BELOW_STACK_FILLER - e.grow as f32 * 10.0)
                    .clamp(priority::YIELDING, priority::BELOW_STACK_FILLER),
                priority::BELOW_STACK_FILLER,
            )
        } else {
            (
                own.hugging.min(priority::BELOW_STACK_FILLER),
                own.compression,
            )
        };
        view.set_content_hugging_priority(hugging, axis);
        view.set_content_compression_resistance_priority(compression, axis);
    }
}

/// Writes the widget's own priorities back and forgets the snapshot, so the
/// next `sync_emphasis` re-reads whatever the widget sets in between.
fn restore_own_priorities(view: &NSView, e: &mut Emphasis) {
    if let Some(saved) = e.saved.take() {
        for (axis, own) in Orientation::BOTH.into_iter().zip(saved) {
            view.set_content_hugging_priority(own.hugging, axis);
            view.set_content_compression_resistance_priority(own.compression, axis);
        }
    }
}

fn size_constraint(
    view: &NSView,
    slot: &mut Option<NSLayoutConstraint>,
    attr: Attr,
    rel: Rel,
    value: Option<f64>,
) {
    match (value, slot.as_ref()) {
        (None, None) => {}
        (None, Some(c)) => {
            c.set_active(false);
            *slot = None;
        }
        (Some(v), Some(c)) => c.set_constant(v.max(0.0)),
        (Some(v), None) => {
            let c = NSLayoutConstraint::with_items(
                view,
                attr,
                rel,
                None,
                Attr::NotAnAttribute,
                1.0,
                v.max(0.0),
            );
            c.set_priority(priority::ALMOST_REQUIRED);
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
