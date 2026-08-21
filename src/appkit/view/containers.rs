//! Kinds that hold other views: stacks, a plain pinning container, scroll
//! views, titled boxes and split views.

use super::{Align, Attr, Cx, Distribution, GROW_SHARE, Orientation, Prop, Rel, Widget, priority};
use crate::error::{Error, Result};
use crate::geometry::{Insets, Rect};
use crate::objc::appkit::{
    BorderType, NSBox, NSClipView, NSLayoutConstraint, NSScrollView, NSSplitView, NSStackView,
    NSView, SplitViewDividerStyle, TitlePosition, WindowOrderingMode,
};
use crate::objc::delegate::flipped_clip_view_class;
use crate::objc::foundation::{NSArray, NSString, Upcast};
use crate::objc::{self, Object};

/// Tags the cross-axis constraints `Stack` adds so `refill` can find them
/// among NSStackView's own.
const FILL_IDENTIFIER: &str = "bun.stack.fill";
/// Beats default content hugging (250) so labels and fields stretch; loses to
/// the window holding its size (500) so a lone hugging child (a button, 750)
/// cannot shrink the window to itself, and to an explicit width/height (999).
/// A fill constraint pulls both ways: a child that will not stretch pulls
/// the stack towards its own width just as hard. Each level of nesting
/// takes one off, so where an inner stack's fill and an outer one's
/// disagree the outer one wins instead of the solver picking either.
const FILL_PRIORITY: f32 = 400.0;
/// Fill stops dropping this far below `FILL_PRIORITY`, still above every
/// hugging priority it has to beat.
const FILL_LEVELS: usize = 100;

/// `NSStackView`.
pub(crate) struct Stack {
    view: NSStackView,
    vertical: bool,
    /// Children span the cross axis (see `fill_child`).
    fill: bool,
    /// Containers between this one and the window content; see `FILL_PRIORITY`.
    depth: usize,
    distribution: Distribution,
    /// Children with a `grow` weight, as last told by `regrow`.
    growers: Vec<(NSView, f64)>,
    /// Ties the growers' lengths together in `grow` ratio; see `share`.
    shares: Vec<NSLayoutConstraint>,
}

const DEFAULT_SPACING: f64 = 8.0;
const DEFAULT_PADDING: Insets = Insets::uniform(0.0);
const DEFAULT_DISTRIBUTION: Distribution = Distribution::Fill;

fn default_align(vertical: bool) -> Align {
    if vertical { Align::Fill } else { Align::Center }
}

impl Stack {
    pub(crate) fn new(_cx: &Cx<'_>, vertical: bool) -> Stack {
        let view = NSStackView::with_views(&NSArray::empty());
        view.set_orientation(if vertical {
            Orientation::Vertical
        } else {
            Orientation::Horizontal
        });
        view.set_spacing(DEFAULT_SPACING);
        view.set_distribution(DEFAULT_DISTRIBUTION.into());
        view.set_detaches_hidden_views(true);
        // A stack should be as easy to stretch as its most willing child,
        // and never clip its children. `contentHuggingPriority` does nothing
        // for a stack itself; it carries the value `grow` saves and restores.
        for axis in Orientation::BOTH {
            view.set_hugging_priority(priority::BELOW_STACK_FILLER, axis);
            view.set_content_hugging_priority(priority::BELOW_STACK_FILLER, axis);
            view.set_content_compression_resistance_priority(priority::DEFAULT_HIGH, axis);
        }
        let mut stack = Stack {
            view,
            vertical,
            fill: false,
            depth: 0,
            distribution: DEFAULT_DISTRIBUTION,
            growers: Vec::new(),
            shares: Vec::new(),
        };
        stack
            .set_align(default_align(vertical))
            .expect("Fill/Center are valid for either orientation");
        stack
    }

    fn set_distribution(&mut self, distribution: Distribution) {
        self.distribution = distribution;
        self.view.set_distribution(distribution.into());
        self.share();
    }

    /// Hugging priorities only say who stretches first, and views with no
    /// intrinsic size (spacers, nested stacks) have none to hug, so with
    /// `Fill` distribution leftover length is handed out explicitly: each
    /// grower's length is tied to the first one's in the ratio of their
    /// weights. Other distributions size children themselves.
    fn share(&mut self) {
        for c in self.shares.drain(..) {
            c.set_active(false);
        }
        if self.distribution != Distribution::Fill {
            return;
        }
        let attr = if self.vertical {
            Attr::Height
        } else {
            Attr::Width
        };
        // A hidden child is detached from the stack's layout; relating it
        // to a sibling would pin that sibling to a stale length.
        let mut growers = self.growers.iter().filter(|(view, _)| {
            !view.is_hidden() && view.superview().as_ref() == Some::<&NSView>(&self.view)
        });
        let Some((first, first_weight)) = growers.next() else {
            return;
        };
        for (view, weight) in growers {
            let c = NSLayoutConstraint::with_items(
                view,
                attr,
                Rel::Equal,
                Some(first),
                attr,
                weight / first_weight,
                0.0,
            );
            c.set_priority(GROW_SHARE);
            c.set_active(true);
            self.shares.push(c);
        }
    }

    fn set_align(&mut self, align: Align) -> Result<()> {
        // NSStackView alignment is a layout attribute on the cross axis. It
        // only positions children there, never sizes them, so `Fill` is
        // leading/centre plus a per-child constraint (`fill_child`).
        let attr = match (self.vertical, align) {
            (true, Align::Fill | Align::Leading | Align::Top) => Attr::Leading,
            (true, Align::Trailing | Align::Bottom) => Attr::Trailing,
            (true, Align::Center) => Attr::CenterX,
            (true, Align::FirstBaseline | Align::LastBaseline) => {
                return Err(Error::BaselineAlignOnVerticalStack);
            }
            (false, Align::Fill | Align::Center) => Attr::CenterY,
            (false, Align::Top | Align::Leading) => Attr::Top,
            (false, Align::Bottom | Align::Trailing) => Attr::Bottom,
            (false, Align::FirstBaseline) => Attr::FirstBaseline,
            (false, Align::LastBaseline) => Attr::LastBaseline,
        };
        self.fill = matches!(align, Align::Fill);
        self.view.set_alignment(attr);
        self.refill();
        Ok(())
    }

    /// With `Align::Fill`, stretch `child` across the cross axis: its width
    /// (or height) equals the stack's, less the edge insets.
    fn fill_child(&self, child: &NSView) {
        if !self.fill {
            return;
        }
        let attr = if self.vertical {
            Attr::Width
        } else {
            Attr::Height
        };
        let insets = self.view.edge_insets();
        let inset = if self.vertical {
            insets.left + insets.right
        } else {
            insets.top + insets.bottom
        };
        let c = NSLayoutConstraint::with_items(
            child,
            attr,
            Rel::Equal,
            Some(&self.view),
            attr,
            1.0,
            -inset,
        );
        c.set_priority(FILL_PRIORITY - self.depth.min(FILL_LEVELS) as f32);
        c.set_identifier(Some(&NSString::from(FILL_IDENTIFIER)));
        c.set_active(true);
    }

    fn set_padding(&self, insets: Insets) {
        self.view.set_edge_insets(insets);
        self.refill();
    }

    fn set_depth(&mut self, depth: usize) {
        if self.depth != depth {
            self.depth = depth;
            self.refill();
        }
    }

    /// Re-applies or removes fill constraints on every arranged child after
    /// `align` or `padding` changes.
    fn refill(&self) {
        let ident = NSString::from(FILL_IDENTIFIER);
        for c in self
            .view
            .constraints()
            .iter()
            .filter_map(|o| o.downcast::<NSLayoutConstraint>().ok())
        {
            if c.identifier()
                .is_some_and(|id| id.is_equal(Some(ident.upcast())))
            {
                c.set_active(false);
            }
        }
        if !self.fill {
            return;
        }
        for child in self
            .view
            .arranged_subviews()
            .iter()
            .filter_map(|o| o.downcast::<NSView>().ok())
        {
            self.fill_child(&child);
        }
    }

    fn arranged_count(&self) -> usize {
        self.view.arranged_subviews().count()
    }
}

impl Widget for Stack {
    fn view(&self) -> &NSView {
        &self.view
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::Spacing(s) => self.view.set_spacing(s.unwrap_or(DEFAULT_SPACING).max(0.0)),
            Prop::Padding(i) => self.set_padding(i.unwrap_or(DEFAULT_PADDING)),
            Prop::Align(a) => self.set_align(a.unwrap_or_else(|| default_align(self.vertical)))?,
            Prop::Distribution(d) => self.set_distribution(d.unwrap_or(DEFAULT_DISTRIBUTION)),
            other => return Ok(Some(other)),
        }
        Ok(None)
    }

    fn regrow(&mut self, children: &[(NSView, f64)]) {
        self.growers = children
            .iter()
            .filter(|(_, weight)| *weight > 0.0)
            .cloned()
            .collect();
        self.share();
    }

    fn nested(&mut self, depth: usize) {
        self.set_depth(depth);
    }

    fn axis(&self) -> Option<Orientation> {
        Some(if self.vertical {
            Orientation::Vertical
        } else {
            Orientation::Horizontal
        })
    }

    fn insert_child(&mut self, _cx: &Cx<'_>, child: &NSView, index: usize) -> Result<()> {
        self.view
            .insert_arranged_subview(child, index.min(self.arranged_count()));
        self.fill_child(child);
        Ok(())
    }

    /// `insertArrangedSubview:atIndex:` on a view already arranged only
    /// reorders it: it stays in the hierarchy with its constraints.
    fn move_child(&mut self, _cx: &Cx<'_>, child: &NSView, index: usize) -> Result<()> {
        if self
            .view
            .arranged_subviews()
            .position(child.upcast())
            .is_none()
        {
            return Err(Error::NotAChild);
        }
        self.view
            .insert_arranged_subview(child, index.min(self.arranged_count()));
        Ok(())
    }

    fn remove_child(&mut self, _cx: &Cx<'_>, child: &NSView) -> Result<()> {
        if self
            .view
            .arranged_subviews()
            .position(child.upcast())
            .is_none()
        {
            return Err(Error::NotAChild);
        }
        self.view.remove_arranged_subview(child);
        child.remove_from_superview();
        Ok(())
    }
}

/// A bare NSView whose children are pinned to all four edges, so several
/// children overlap back to front. Used for window content and `View`.
pub(crate) struct Plain {
    view: NSView,
}

impl Plain {
    pub(crate) fn new(_cx: &Cx<'_>) -> Plain {
        let view = NSView::init_with_frame(objc::alloc::<NSView>(), Rect::default());
        Plain { view }
    }
}

/// Pins `child` to every edge of `parent` with `padding`.
pub(crate) fn pin_edges(parent: &NSView, child: &NSView, padding: f64) {
    child.set_translates_autoresizing_mask(false);
    for (attr, k) in [
        (Attr::Leading, padding),
        (Attr::Top, padding),
        (Attr::Trailing, -padding),
        (Attr::Bottom, -padding),
    ] {
        NSLayoutConstraint::with_items(child, attr, Rel::Equal, Some(parent), attr, 1.0, k)
            .set_active(true);
    }
}

impl Widget for Plain {
    fn view(&self) -> &NSView {
        &self.view
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        Ok(Some(prop))
    }

    /// Subview order is children order: index 0 is back-most.
    fn insert_child(&mut self, _cx: &Cx<'_>, child: &NSView, index: usize) -> Result<()> {
        let subviews = self.view.subviews();
        match subviews
            .get(index)
            .and_then(|o| o.downcast::<NSView>().ok())
        {
            Some(anchor) => {
                self.view
                    .add_subview_positioned(child, WindowOrderingMode::Below, Some(&anchor));
            }
            None => self.view.add_subview(child),
        }
        pin_edges(&self.view, child, 0.0);
        Ok(())
    }

    /// Re-adding a subview to its own superview only changes its z-order.
    fn move_child(&mut self, _cx: &Cx<'_>, child: &NSView, index: usize) -> Result<()> {
        if child.superview().as_ref() != Some(&self.view) {
            return Err(Error::NotAChild);
        }
        let siblings: Vec<NSView> = self
            .view
            .subviews()
            .iter()
            .filter_map(|o| o.downcast::<NSView>().ok())
            .filter(|sibling| sibling != child)
            .collect();
        match siblings.get(index) {
            Some(anchor) => {
                self.view
                    .add_subview_positioned(child, WindowOrderingMode::Below, Some(anchor));
            }
            None => self
                .view
                .add_subview_positioned(child, WindowOrderingMode::Above, None),
        }
        Ok(())
    }

    fn remove_child(&mut self, _cx: &Cx<'_>, child: &NSView) -> Result<()> {
        remove_subview(&self.view, child)
    }
}

/// Removes `child` if `parent` is its superview. AppKit drops constraints
/// involving the child when it leaves the hierarchy.
fn remove_subview(parent: &NSView, child: &NSView) -> Result<()> {
    if child.superview().as_ref() != Some(parent) {
        return Err(Error::NotAChild);
    }
    child.remove_from_superview();
    Ok(())
}

/// `NSScrollView` with a flipped clip view so content starts at the top.
pub(crate) struct Scroll {
    view: NSScrollView,
    document: Option<ScrollDocument>,
    horizontal: bool,
}

struct ScrollDocument {
    view: NSView,
    /// Ties the document's width to the clip view's; see `document_width`.
    width: NSLayoutConstraint,
}

const DEFAULT_HORIZONTAL_SCROLL_BAR: bool = false;
const DEFAULT_VERTICAL_SCROLL_BAR: bool = true;

impl Scroll {
    pub(crate) fn new(_cx: &Cx<'_>) -> Scroll {
        let view = NSScrollView::init_with_frame(objc::alloc::<NSScrollView>(), Rect::default());
        // NSScrollView positions its clip view with frames, so the clip keeps
        // autoresizing on.
        let clip = NSClipView::init_with_frame(
            objc::alloc_subclass(flipped_clip_view_class()),
            Rect::default(),
        );
        clip.set_draws_background(false);
        view.set_content_view(&clip);
        view.set_has_vertical_scroller(DEFAULT_VERTICAL_SCROLL_BAR);
        view.set_has_horizontal_scroller(DEFAULT_HORIZONTAL_SCROLL_BAR);
        view.set_autohides_scrollers(true);
        view.set_draws_background(false);
        view.set_border_type(BorderType::NoBorder);
        for axis in Orientation::BOTH {
            view.set_content_hugging_priority(priority::YIELDING, axis);
            view.set_content_compression_resistance_priority(priority::YIELDING, axis);
        }
        Scroll {
            view,
            document: None,
            horizontal: DEFAULT_HORIZONTAL_SCROLL_BAR,
        }
    }

    /// The document is at least as wide as the clip view: exactly as wide
    /// when there is no horizontal scroller, so text wraps instead of running
    /// off to the right.
    fn document_width(&self, document: &NSView) -> NSLayoutConstraint {
        let rel = if self.horizontal {
            Rel::GreaterOrEqual
        } else {
            Rel::Equal
        };
        let clip = self.view.content_view();
        let width = NSLayoutConstraint::with_items(
            document,
            Attr::Width,
            rel,
            Some(&clip),
            Attr::Width,
            1.0,
            0.0,
        );
        width.set_active(true);
        width
    }
}

impl Widget for Scroll {
    fn view(&self) -> &NSView {
        &self.view
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::ScrollBars {
                horizontal,
                vertical,
            } => {
                let horizontal = horizontal.unwrap_or(DEFAULT_HORIZONTAL_SCROLL_BAR);
                let vertical = vertical.unwrap_or(DEFAULT_VERTICAL_SCROLL_BAR);
                self.view.set_has_horizontal_scroller(horizontal);
                self.view.set_has_vertical_scroller(vertical);
                if horizontal != self.horizontal {
                    self.horizontal = horizontal;
                    if let Some(doc) = self.document.take() {
                        doc.width.set_active(false);
                        let width = self.document_width(&doc.view);
                        self.document = Some(ScrollDocument { width, ..doc });
                    }
                }
                Ok(None)
            }
            other => Ok(Some(other)),
        }
    }

    fn insert_child(&mut self, cx: &Cx<'_>, child: &NSView, _index: usize) -> Result<()> {
        if self.document.is_some() {
            return Err(Error::AlreadyHasChild(cx.kind));
        }
        self.view.set_document_view(Some(child));
        let clip = self.view.content_view();
        // Top and leading track the clip view and `document_width` ties the
        // widths; the height floor keeps short content at the top instead of
        // centred.
        child.set_translates_autoresizing_mask(false);
        for (attr, rel) in [
            (Attr::Leading, Rel::Equal),
            (Attr::Top, Rel::Equal),
            (Attr::Height, Rel::GreaterOrEqual),
        ] {
            NSLayoutConstraint::with_items(child, attr, rel, Some(&clip), attr, 1.0, 0.0)
                .set_active(true);
        }
        let width = self.document_width(child);
        self.document = Some(ScrollDocument {
            view: child.clone(),
            width,
        });
        Ok(())
    }

    fn move_child(&mut self, _cx: &Cx<'_>, child: &NSView, _index: usize) -> Result<()> {
        if self.document.as_ref().map(|d| &d.view) != Some(child) {
            return Err(Error::NotAChild);
        }
        Ok(())
    }

    fn remove_child(&mut self, _cx: &Cx<'_>, child: &NSView) -> Result<()> {
        if self.document.as_ref().map(|d| &d.view) != Some(child) {
            return Err(Error::NotAChild);
        }
        self.view.set_document_view(None);
        self.document = None;
        Ok(())
    }
}

/// `NSBox` with an internal vertical stack for its children.
pub(crate) struct Group {
    view: NSBox,
    stack: Stack,
}

/// Inside the box's own margin, so children clear its rounded border.
const GROUP_PADDING: Insets = Insets::uniform(4.0);

impl Group {
    pub(crate) fn new(cx: &Cx<'_>) -> Group {
        let stack = Stack::new(cx, true);
        let view = NSBox::init_with_frame(objc::alloc::<NSBox>(), Rect::default());
        view.set_title_position(TitlePosition::NoTitle);
        // The box lays its own content view out by frame (autoresizing
        // constraints that track the box, its margins and title), so the
        // stack goes inside that view rather than replacing it: pinned edge
        // to edge, the stack's size then decides the box's.
        let content = view.content_view().expect("a new NSBox has a content view");
        content.add_subview(&stack.view);
        pin_edges(&content, &stack.view, 0.0);
        stack.set_padding(GROUP_PADDING);
        Group { view, stack }
    }
}

impl Widget for Group {
    fn view(&self) -> &NSView {
        &self.view
    }

    fn set<'p>(&mut self, cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::Text(t) => {
                self.view.set_title(&NSString::from_str(t));
                self.view.set_title_position(if t.is_empty() {
                    TitlePosition::NoTitle
                } else {
                    TitlePosition::AtTop
                });
                Ok(None)
            }
            Prop::Padding(i) => {
                self.stack.set_padding(i.unwrap_or(GROUP_PADDING));
                Ok(None)
            }
            other => self.stack.set(cx, other),
        }
    }

    fn axis(&self) -> Option<Orientation> {
        self.stack.axis()
    }

    fn insert_child(&mut self, cx: &Cx<'_>, child: &NSView, index: usize) -> Result<()> {
        self.stack.insert_child(cx, child, index)
    }

    fn move_child(&mut self, cx: &Cx<'_>, child: &NSView, index: usize) -> Result<()> {
        self.stack.move_child(cx, child, index)
    }

    fn remove_child(&mut self, cx: &Cx<'_>, child: &NSView) -> Result<()> {
        self.stack.remove_child(cx, child)
    }

    fn regrow(&mut self, children: &[(NSView, f64)]) {
        self.stack.regrow(children);
    }

    fn nested(&mut self, depth: usize) {
        self.stack.set_depth(depth);
    }
}

/// `NSSplitView` using arranged subviews.
pub(crate) struct Split {
    view: NSSplitView,
    vertical: bool,
}

const DEFAULT_SPLIT_VERTICAL: bool = false;

impl Split {
    pub(crate) fn new(_cx: &Cx<'_>) -> Split {
        let view = NSSplitView::init_with_frame(objc::alloc::<NSSplitView>(), Rect::default());
        view.set_divider_style(SplitViewDividerStyle::Thin);
        view.set_arranges_all_subviews(false);
        let mut split = Split {
            view,
            vertical: DEFAULT_SPLIT_VERTICAL,
        };
        split.set_vertical(DEFAULT_SPLIT_VERTICAL);
        split
    }

    /// NSSplitView's "vertical" means vertical *dividers* (side by side
    /// panes); ours means panes stacked vertically, like VStack.
    fn set_vertical(&mut self, vertical: bool) {
        self.vertical = vertical;
        self.view.set_vertical(!vertical);
    }
}

impl Widget for Split {
    fn view(&self) -> &NSView {
        &self.view
    }

    fn set<'p>(&mut self, _cx: &Cx<'_>, prop: Prop<'p>) -> Result<Option<Prop<'p>>> {
        match prop {
            Prop::Vertical(v) => {
                self.set_vertical(v.unwrap_or(DEFAULT_SPLIT_VERTICAL));
                Ok(None)
            }
            other => Ok(Some(other)),
        }
    }

    fn axis(&self) -> Option<Orientation> {
        Some(if self.vertical {
            Orientation::Vertical
        } else {
            Orientation::Horizontal
        })
    }

    fn holds_children_loosely(&self) -> bool {
        true
    }

    fn insert_child(&mut self, _cx: &Cx<'_>, child: &NSView, index: usize) -> Result<()> {
        let count = self.view.arranged_subviews().count();
        self.view.insert_arranged_subview(child, index.min(count));
        Ok(())
    }

    fn move_child(&mut self, _cx: &Cx<'_>, child: &NSView, index: usize) -> Result<()> {
        let panes = self.view.arranged_subviews();
        if panes.position(child.upcast()).is_none() {
            return Err(Error::NotAChild);
        }
        self.view
            .insert_arranged_subview(child, index.min(panes.count()));
        Ok(())
    }

    fn remove_child(&mut self, _cx: &Cx<'_>, child: &NSView) -> Result<()> {
        if child.superview().as_ref() != Some::<&NSView>(&self.view) {
            return Err(Error::NotAChild);
        }
        self.view.remove_arranged_subview(child);
        child.remove_from_superview();
        Ok(())
    }

    /// The pane with the lowest holding priority is the one the split view
    /// resizes, so a larger `grow` holds less; no `grow` keeps AppKit's
    /// default.
    fn regrow(&mut self, children: &[(NSView, f64)]) {
        let panes = self.view.arranged_subviews();
        for (view, weight) in children {
            let Some(index) = panes.position(view.upcast()) else {
                continue;
            };
            let holding = if *weight > 0.0 {
                (priority::BELOW_STACK_FILLER - *weight as f32 * 10.0)
                    .clamp(priority::YIELDING, priority::BELOW_STACK_FILLER)
            } else {
                priority::DEFAULT_LOW
            };
            self.view
                .set_holding_priority(holding, isize::try_from(index).unwrap_or(isize::MAX));
        }
    }
}
