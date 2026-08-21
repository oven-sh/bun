//! AppKit bindings. One line per method: the Rust signature on the left is a
//! transcription of the Objective-C one named on the right. `isize`/`usize`
//! are `NSInteger`/`NSUInteger`, `f64` is `CGFloat`, `bool` is `BOOL`,
//! `Option<&T>` is a nullable object argument. Object returns: `T` is a +0
//! nonnull return, `Option<T>` +0 nullable, `Retained<T>` +1 nonnull and
//! `Retained<Option<T>>` +1 nullable (both `Retained` forms yield `T` /
//! `Option<T>` from the generated method). Nullability follows Apple's headers.

use super::foundation::{NSArray, NSData, NSDate, NSIndexSet, NSObject, NSString};
use super::{CGColor, Sel, objc_class, objc_global, objc_methods};
use crate::geometry::{Insets, Point, Rect, Size};

// ───────────────────────────── application ─────────────────────────────────

/// `NSApplicationActivationPolicy`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(isize)]
pub(crate) enum ActivationPolicy {
    Regular = 0,
    Accessory = 1,
    Prohibited = 2,
}

objc_class!(pub struct NSApplication: NSObject = "NSApplication");
objc_methods! { impl NSApplication {
    pub fn shared() -> NSApplication = "sharedApplication";
    pub fn set_activation_policy(&self, policy: ActivationPolicy) -> bool = "setActivationPolicy:";
    pub fn activate_ignoring_other_apps(&self, flag: bool) = "activateIgnoringOtherApps:";
    pub fn finish_launching(&self) = "finishLaunching";
    pub fn run(&self) = "run";
    pub fn stop(&self, sender: Option<&NSObject>) = "stop:";
    pub fn terminate(&self, sender: Option<&NSObject>) = "terminate:";
    pub fn is_running(&self) -> bool = "isRunning";
    pub fn hide(&self, sender: Option<&NSObject>) = "hide:";
    pub fn unhide(&self, sender: Option<&NSObject>) = "unhide:";
    pub fn next_event(&self, mask: u64, until: Option<&NSDate>, mode: &NSString, dequeue: bool) -> Option<NSEvent>
        = "nextEventMatchingMask:untilDate:inMode:dequeue:";
    pub fn send_event(&self, event: &NSEvent) = "sendEvent:";
    pub fn post_event(&self, event: &NSEvent, at_start: bool) = "postEvent:atStart:";
    pub fn update_windows(&self) = "updateWindows";
    pub fn set_delegate(&self, delegate: Option<&NSObject>) = "setDelegate:";
    pub fn set_main_menu(&self, menu: Option<&NSMenu>) = "setMainMenu:";
    pub fn set_windows_menu(&self, menu: Option<&NSMenu>) = "setWindowsMenu:";
    pub fn set_services_menu(&self, menu: Option<&NSMenu>) = "setServicesMenu:";
    pub fn dock_tile(&self) -> NSDockTile = "dockTile";
    pub fn effective_appearance(&self) -> NSAppearance = "effectiveAppearance";
    // pub fn windows(&self) -> NSArray = "windows";
    pub fn current_event(&self) -> Option<NSEvent> = "currentEvent";
    // pub fn key_window(&self) -> Option<NSWindow> = "keyWindow";
    // pub fn set_application_icon_image(&self, image: Option<&NSImage>) = "setApplicationIconImage:";
}}

objc_class!(pub struct NSDockTile: NSObject = "NSDockTile");
objc_methods! { impl NSDockTile {
    pub fn set_badge_label(&self, label: Option<&NSString>) = "setBadgeLabel:";
}}

objc_class!(pub struct NSAppearance: NSObject = "NSAppearance");
objc_methods! { impl NSAppearance {
    // pub fn named(name: &NSString) -> Option<NSAppearance> = "appearanceNamed:";
    pub fn name(&self) -> NSString = "name";
    /// The appearance dynamic colours resolve against (`-[NSColor CGColor]`); AppKit sets it only while drawing.
    /// Deprecated pair (macOS 12); the replacement, `performAsCurrentDrawingAppearance:`, takes a block.
    pub fn current_appearance() -> NSAppearance = "currentAppearance";
    pub fn set_current_appearance(appearance: Option<&NSAppearance>) = "setCurrentAppearance:";
}}

objc_class!(pub struct NSEvent: NSObject = "NSEvent");
objc_methods! { impl NSEvent {
    #[allow(clippy::too_many_arguments)]
    pub fn other_event(kind: usize, location: Point, flags: usize, timestamp: f64, window_number: isize,
                       context: Option<&NSObject>, subtype: i16, data1: isize, data2: isize) -> Option<NSEvent>
        = "otherEventWithType:location:modifierFlags:timestamp:windowNumber:context:subtype:data1:data2:";
    pub fn kind(&self) -> usize = "type";
    pub fn subtype(&self) -> i16 = "subtype";
}}

objc_class!(pub struct NSRunningApplication: NSObject = "NSRunningApplication");
objc_methods! { impl NSRunningApplication {
    pub fn current() -> NSRunningApplication = "currentApplication";
    pub fn is_finished_launching(&self) -> bool = "isFinishedLaunching";
}}

objc_class!(pub struct NSScreen: NSObject = "NSScreen");
objc_methods! { impl NSScreen {
    // pub fn main() -> Option<NSScreen> = "mainScreen";
    pub fn screens() -> NSArray = "screens";
    // pub fn frame(&self) -> Rect = "frame";
    // pub fn visible_frame(&self) -> Rect = "visibleFrame";
    // pub fn backing_scale_factor(&self) -> f64 = "backingScaleFactor";
}}

// ─────────────────────────────── menus ─────────────────────────────────────

objc_class!(pub struct NSMenu: NSObject = "NSMenu");
objc_methods! { impl NSMenu {
    pub fn init_with_title(this: Allocated<Self>, title: &NSString) -> Retained<NSMenu> = "initWithTitle:";
    pub fn title(&self) -> NSString = "title";
    pub fn add_item(&self, item: &NSMenuItem) = "addItem:";
    // pub fn remove_all_items(&self) = "removeAllItems";
    // pub fn set_autoenables_items(&self, flag: bool) = "setAutoenablesItems:";
    // pub fn item_array(&self) -> NSArray = "itemArray";
}}

objc_class!(pub struct NSMenuItem: NSObject = "NSMenuItem");
objc_methods! { impl NSMenuItem {
    pub fn init_with_title(this: Allocated<Self>, title: &NSString, action: Option<Sel>, key: &NSString) -> Retained<NSMenuItem>
        = "initWithTitle:action:keyEquivalent:";
    pub fn separator() -> NSMenuItem = "separatorItem";
    pub fn set_submenu(&self, menu: Option<&NSMenu>) = "setSubmenu:";
    pub fn set_target(&self, target: Option<&NSObject>) = "setTarget:";
    pub fn set_key_equivalent_modifier_mask(&self, mask: usize) = "setKeyEquivalentModifierMask:";
    pub fn set_enabled(&self, enabled: bool) = "setEnabled:";
    pub fn set_tag(&self, tag: isize) = "setTag:";
    pub fn tag(&self) -> isize = "tag";
    pub fn set_state(&self, state: ControlStateValue) = "setState:";
}}

// ─────────────────────────────── windows ───────────────────────────────────

objc_class!(pub struct NSWindow: NSObject = "NSWindow");
objc_methods! { impl NSWindow {
    pub fn init_with_content_rect(this: Allocated<Self>, rect: Rect, style_mask: usize, backing: BackingStoreType, defer: bool) -> Retained<NSWindow>
        = "initWithContentRect:styleMask:backing:defer:";
    pub fn set_released_when_closed(&self, flag: bool) = "setReleasedWhenClosed:";
    pub fn set_delegate(&self, delegate: Option<&NSObject>) = "setDelegate:";
    pub fn set_title(&self, title: &NSString) = "setTitle:";
    pub fn title(&self) -> NSString = "title";
    // pub fn set_subtitle(&self, subtitle: &NSString) = "setSubtitle:";
    // pub fn set_content_view(&self, view: Option<&NSView>) = "setContentView:";
    pub fn content_view(&self) -> Option<NSView> = "contentView";
    pub fn set_content_size(&self, size: Size) = "setContentSize:";
    pub fn set_content_min_size(&self, size: Size) = "setContentMinSize:";
    pub fn set_content_max_size(&self, size: Size) = "setContentMaxSize:";
    pub fn content_rect_for_frame_rect(&self, frame: Rect) -> Rect = "contentRectForFrameRect:";
    // pub fn frame_rect_for_content_rect(&self, content: Rect) -> Rect = "frameRectForContentRect:";
    pub fn frame(&self) -> Rect = "frame";
    // pub fn set_frame(&self, frame: Rect, display: bool) = "setFrame:display:";
    pub fn set_frame_origin(&self, origin: Point) = "setFrameOrigin:";
    // pub fn set_frame_top_left_point(&self, point: Point) = "setFrameTopLeftPoint:";
    // pub fn set_style_mask(&self, mask: usize) = "setStyleMask:";
    // pub fn style_mask(&self) -> usize = "styleMask";
    pub fn make_key_and_order_front(&self, sender: Option<&NSObject>) = "makeKeyAndOrderFront:";
    // pub fn order_front(&self, sender: Option<&NSObject>) = "orderFront:";
    pub fn order_out(&self, sender: Option<&NSObject>) = "orderOut:";
    pub fn center(&self) = "center";
    pub fn close(&self) = "close";
    // pub fn perform_close(&self, sender: Option<&NSObject>) = "performClose:";
    pub fn is_visible(&self) -> bool = "isVisible";
    pub fn is_key_window(&self) -> bool = "isKeyWindow";
    // pub fn is_miniaturized(&self) -> bool = "isMiniaturized";
    // pub fn miniaturize(&self, sender: Option<&NSObject>) = "miniaturize:";
    // pub fn deminiaturize(&self, sender: Option<&NSObject>) = "deminiaturize:";
    // pub fn is_zoomed(&self) -> bool = "isZoomed";
    // pub fn zoom(&self, sender: Option<&NSObject>) = "zoom:";
    // pub fn toggle_full_screen(&self, sender: Option<&NSObject>) = "toggleFullScreen:";
    pub fn set_titlebar_appears_transparent(&self, flag: bool) = "setTitlebarAppearsTransparent:";
    pub fn set_title_visibility(&self, visibility: WindowTitleVisibility) = "setTitleVisibility:";
    // pub fn set_movable_by_window_background(&self, flag: bool) = "setMovableByWindowBackground:";
    pub fn set_background_color(&self, color: Option<&NSColor>) = "setBackgroundColor:";
    // pub fn set_opaque(&self, flag: bool) = "setOpaque:";
    // pub fn set_has_shadow(&self, flag: bool) = "setHasShadow:";
    // pub fn set_level(&self, level: isize) = "setLevel:";
    pub fn set_alpha_value(&self, alpha: f64) = "setAlphaValue:";
    // pub fn set_min_size(&self, size: Size) = "setMinSize:";
    // pub fn set_max_size(&self, size: Size) = "setMaxSize:";
    pub fn set_frame_autosave_name(&self, name: &NSString) -> bool = "setFrameAutosaveName:";
    pub fn set_collection_behavior(&self, behavior: usize) = "setCollectionBehavior:";
    // pub fn make_first_responder(&self, responder: Option<&NSView>) -> bool = "makeFirstResponder:";
    // pub fn set_initial_first_responder(&self, view: Option<&NSView>) = "setInitialFirstResponder:";
    // pub fn set_document_edited(&self, flag: bool) = "setDocumentEdited:";
    // pub fn set_represented_filename(&self, path: &NSString) = "setRepresentedFilename:";
    // pub fn screen(&self) -> Option<NSScreen> = "screen";
    // pub fn backing_scale_factor(&self) -> f64 = "backingScaleFactor";
    // pub fn set_appearance(&self, appearance: Option<&NSAppearance>) = "setAppearance:";
    pub fn layout_if_needed(&self) = "layoutIfNeeded";
    // pub fn display_if_needed(&self) = "displayIfNeeded";
    // pub fn set_default_button_cell(&self, cell: Option<&NSCell>) = "setDefaultButtonCell:";
    pub fn default_button_cell(&self) -> Option<NSCell> = "defaultButtonCell";
}}

// ─────────────────────────────── views ─────────────────────────────────────

objc_class!(pub struct NSView: NSObject = "NSView");
objc_methods! { impl NSView {
    pub fn init_with_frame(this: Allocated<Self>, frame: Rect) -> Retained<NSView> = "initWithFrame:";
    pub fn set_translates_autoresizing_mask(&self, flag: bool) = "setTranslatesAutoresizingMaskIntoConstraints:";
    pub fn add_subview(&self, view: &NSView) = "addSubview:";
    pub fn add_subview_positioned(&self, view: &NSView, place: WindowOrderingMode, relative_to: Option<&NSView>)
        = "addSubview:positioned:relativeTo:";
    pub fn remove_from_superview(&self) = "removeFromSuperview";
    pub fn is_descendant_of(&self, view: &NSView) -> bool = "isDescendantOf:";
    pub fn superview(&self) -> Option<NSView> = "superview";
    pub fn subviews(&self) -> NSArray = "subviews";
    pub fn window(&self) -> Option<NSWindow> = "window";
    pub fn set_hidden(&self, hidden: bool) = "setHidden:";
    pub fn is_hidden(&self) -> bool = "isHidden";
    pub fn set_alpha_value(&self, alpha: f64) = "setAlphaValue:";
    pub fn set_tool_tip(&self, text: Option<&NSString>) = "setToolTip:";
    pub fn set_identifier(&self, identifier: Option<&NSString>) = "setIdentifier:";
    // pub fn identifier(&self) -> Option<NSString> = "identifier";
    pub fn set_wants_layer(&self, flag: bool) = "setWantsLayer:";
    pub fn layer(&self) -> Option<CALayer> = "layer";
    pub fn frame(&self) -> Rect = "frame";
    // pub fn set_frame(&self, frame: Rect) = "setFrame:";
    // pub fn set_frame_size(&self, size: Size) = "setFrameSize:";
    pub fn bounds(&self) -> Rect = "bounds";
    // pub fn fitting_size(&self) -> Size = "fittingSize";
    // pub fn intrinsic_content_size(&self) -> Size = "intrinsicContentSize";
    pub fn content_hugging_priority(&self, orientation: Orientation) -> f32 = "contentHuggingPriorityForOrientation:";
    pub fn set_content_hugging_priority(&self, priority: f32, orientation: Orientation) = "setContentHuggingPriority:forOrientation:";
    pub fn content_compression_resistance_priority(&self, orientation: Orientation) -> f32
        = "contentCompressionResistancePriorityForOrientation:";
    pub fn set_content_compression_resistance_priority(&self, priority: f32, orientation: Orientation)
        = "setContentCompressionResistancePriority:forOrientation:";
    // pub fn set_needs_display(&self, flag: bool) = "setNeedsDisplay:";
    // pub fn set_needs_layout(&self, flag: bool) = "setNeedsLayout:";
    pub fn layout_subtree_if_needed(&self) = "layoutSubtreeIfNeeded";
    pub fn effective_appearance(&self) -> NSAppearance = "effectiveAppearance";
    pub fn constraints(&self) -> NSArray = "constraints";
    // pub fn set_autoresizing_mask(&self, mask: usize) = "setAutoresizingMask:";
    pub fn bitmap_image_rep_for_caching_display_in_rect(&self, rect: Rect) -> Option<NSBitmapImageRep>
        = "bitmapImageRepForCachingDisplayInRect:";
    pub fn cache_display_in_rect(&self, rect: Rect, rep: &NSBitmapImageRep) = "cacheDisplayInRect:toBitmapImageRep:";
    // pub fn enclosing_scroll_view(&self) -> Option<NSScrollView> = "enclosingScrollView";
    // pub fn scroll_point(&self, point: Point) = "scrollPoint:";
}}

objc_class!(pub struct CALayer: NSObject = "CALayer");
objc_methods! { impl CALayer {
    pub fn set_background_color(&self, color: Option<CGColor>) = "setBackgroundColor:";
    pub fn set_corner_radius(&self, radius: f64) = "setCornerRadius:";
    pub fn set_masks_to_bounds(&self, flag: bool) = "setMasksToBounds:";
    pub fn set_border_width(&self, width: f64) = "setBorderWidth:";
    pub fn set_border_color(&self, color: Option<CGColor>) = "setBorderColor:";
}}

objc_class!(pub struct NSBitmapImageRep: NSObject = "NSBitmapImageRep");
objc_methods! { impl NSBitmapImageRep {
    pub fn representation(&self, file_type: BitmapImageFileType, properties: Option<&NSObject>) -> Option<NSData>
        = "representationUsingType:properties:";
    // pub fn pixels_wide(&self) -> isize = "pixelsWide";
    // pub fn pixels_high(&self) -> isize = "pixelsHigh";
}}

/// `NSLayoutAttribute`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(isize)]
pub(crate) enum LayoutAttribute {
    NotAnAttribute = 0,
    Top = 3,
    Bottom = 4,
    Leading = 5,
    Trailing = 6,
    Width = 7,
    Height = 8,
    CenterX = 9,
    CenterY = 10,
    LastBaseline = 11,
    FirstBaseline = 12,
}

/// `NSLayoutRelation`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(isize)]
pub(crate) enum LayoutRelation {
    LessOrEqual = -1,
    Equal = 0,
    GreaterOrEqual = 1,
}

/// `NSWindowOrderingMode`, also the `positioned:` of `addSubview:positioned:relativeTo:`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(isize)]
pub(crate) enum WindowOrderingMode {
    Above = 1,
    Below = -1,
    // Out = 0,
}

/// `NSUserInterfaceLayoutOrientation` / `NSLayoutConstraintOrientation`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(isize)]
pub(crate) enum Orientation {
    Horizontal = 0,
    Vertical = 1,
}

impl Orientation {
    pub(crate) const BOTH: [Orientation; 2] = [Orientation::Horizontal, Orientation::Vertical];
}

/// `NSTextAlignment`. Center and Right swap between arm64
/// (`TARGET_ABI_USES_IOS_VALUES`: Center=1, Right=2) and x86_64 (Right=1, Center=2).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(isize)]
pub(crate) enum TextAlignment {
    Left = 0,
    Center = if cfg!(target_arch = "x86_64") { 2 } else { 1 },
    Right = if cfg!(target_arch = "x86_64") { 1 } else { 2 },
    Justified = 3,
    Natural = 4,
}

/// `NSStackViewDistribution`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(isize)]
pub(crate) enum StackDistribution {
    GravityAreas = -1,
    Fill = 0,
    FillEqually = 1,
    FillProportionally = 2,
    EqualSpacing = 3,
    EqualCentering = 4,
}

/// `NSImageScaling`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub(crate) enum ImageScaling {
    ProportionallyDown = 0,
    AxesIndependently = 1,
    None = 2,
    ProportionallyUpOrDown = 3,
}

/// `NSLayoutPriority` values shared by the widgets.
pub(crate) mod priority {
    /// Lowest there is: gives way to everything (spacers, a divider's long axis, scroll views).
    pub(crate) const YIELDING: f32 = 1.0;
    /// Just under NSStackView's own filler (250): a view at this hugging stretches before the filler does.
    pub(crate) const BELOW_STACK_FILLER: f32 = 249.0;
    /// `NSLayoutPriorityDefaultLow`, NSView's stock content hugging.
    pub(crate) const DEFAULT_LOW: f32 = 250.0;
    /// `NSLayoutPriorityDefaultHigh`.
    pub(crate) const DEFAULT_HIGH: f32 = 750.0;
    /// Just below `NSLayoutPriorityRequired`, so an impossible size compresses the view instead of raising.
    pub(crate) const ALMOST_REQUIRED: f32 = 999.0;
}

/// `NSLineBreakMode`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub(crate) enum LineBreakMode {
    ByWordWrapping = 0,
    // ByCharWrapping = 1,
    // ByClipping = 2,
    // ByTruncatingHead = 3,
    ByTruncatingTail = 4,
    // ByTruncatingMiddle = 5,
}

/// `NSBoxType`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub(crate) enum BoxType {
    // Primary = 0,
    Separator = 2,
    // Custom = 4,
}

/// `NSTitlePosition`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub(crate) enum TitlePosition {
    NoTitle = 0,
    // AboveTop = 1,
    AtTop = 2,
    // BelowTop = 3,
    // AboveBottom = 4,
    // AtBottom = 5,
    // BelowBottom = 6,
}

/// `NSSplitViewDividerStyle`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(isize)]
pub(crate) enum SplitViewDividerStyle {
    // Thick = 1,
    Thin = 2,
    // PaneSplitter = 3,
}

/// `NSBorderType`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub(crate) enum BorderType {
    NoBorder = 0,
    // Line = 1,
    // Bezel = 2,
    // Groove = 3,
}

/// `NSControlStateValue`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(isize)]
pub(crate) enum ControlStateValue {
    // Mixed = -1,
    Off = 0,
    On = 1,
}

impl From<bool> for ControlStateValue {
    fn from(on: bool) -> Self {
        if on { Self::On } else { Self::Off }
    }
}

impl ControlStateValue {
    pub(crate) fn is_on(raw: isize) -> bool {
        raw == ControlStateValue::On as isize
    }
}

/// `NSBezelStyle`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub(crate) enum BezelStyle {
    // Automatic = 0,
    Push = 1,
    // FlexiblePush = 2,
    // Disclosure = 5,
    // Circular = 7,
    // HelpButton = 9,
    // SmallSquare = 10,
    Toolbar = 11,
    // AccessoryBarAction = 12,
    // AccessoryBar = 13,
    // PushDisclosure = 14,
    // Badge = 15,
}

/// `NSCellImagePosition`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub(crate) enum CellImagePosition {
    NoImage = 0,
    ImageOnly = 1,
    ImageLeft = 2,
    // ImageRight = 3,
    // ImageBelow = 4,
    // ImageAbove = 5,
    // ImageOverlaps = 6,
    // ImageLeading = 7,
    // ImageTrailing = 8,
}

/// `NSProgressIndicatorStyle`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub(crate) enum ProgressIndicatorStyle {
    Bar = 0,
    Spinning = 1,
}

/// `NSControlSize`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub(crate) enum ControlSize {
    Regular = 0,
    // Small = 1,
    // Mini = 2,
    // Large = 3,
}

/// `NSTableViewColumnAutoresizingStyle`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub(crate) enum ColumnAutoresizingStyle {
    // NoAutoresizing = 0,
    // Uniform = 1,
    // Sequential = 2,
    // ReverseSequential = 3,
    LastColumnOnly = 4,
    // FirstColumnOnly = 5,
}

/// `NSSegmentSwitchTracking`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub(crate) enum SegmentSwitchTracking {
    SelectOne = 0,
    // SelectAny = 1,
    // Momentary = 2,
    // MomentaryAccelerator = 3,
}

/// `NSSegmentDistribution`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(isize)]
pub(crate) enum SegmentDistribution {
    // Fit = 0,
    Fill = 1,
    // FillEqually = 2,
    // FillProportionally = 3,
}

/// `NSWindowTitleVisibility`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(isize)]
pub(crate) enum WindowTitleVisibility {
    // Visible = 0,
    Hidden = 1,
}

/// `NSBackingStoreType`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub(crate) enum BackingStoreType {
    Buffered = 2,
}

/// `NSBitmapImageFileType`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(usize)]
pub(crate) enum BitmapImageFileType {
    // Tiff = 0,
    // Bmp = 1,
    // Gif = 2,
    // Jpeg = 3,
    Png = 4,
    // Jpeg2000 = 5,
}

objc_class!(pub struct NSLayoutConstraint: NSObject = "NSLayoutConstraint");
objc_methods! { impl NSLayoutConstraint {
    #[allow(clippy::too_many_arguments)]
    pub fn with_items(view1: &NSView, attr1: LayoutAttribute, relation: LayoutRelation, view2: Option<&NSView>, attr2: LayoutAttribute, multiplier: f64, constant: f64)
        -> NSLayoutConstraint = "constraintWithItem:attribute:relatedBy:toItem:attribute:multiplier:constant:";
    pub fn set_active(&self, active: bool) = "setActive:";
    pub fn set_constant(&self, constant: f64) = "setConstant:";
    pub fn set_priority(&self, priority: f32) = "setPriority:";
    pub fn set_identifier(&self, identifier: Option<&NSString>) = "setIdentifier:";
    pub fn identifier(&self) -> Option<NSString> = "identifier";
}}

objc_class!(pub struct NSStackView: NSView = "NSStackView");
objc_methods! { impl NSStackView {
    pub fn with_views(views: &NSArray) -> NSStackView = "stackViewWithViews:";
    pub fn set_orientation(&self, orientation: Orientation) = "setOrientation:";
    pub fn set_spacing(&self, spacing: f64) = "setSpacing:";
    pub fn set_edge_insets(&self, insets: Insets) = "setEdgeInsets:";
    pub fn edge_insets(&self) -> Insets = "edgeInsets";
    pub fn set_alignment(&self, attribute: LayoutAttribute) = "setAlignment:";
    pub fn set_distribution(&self, distribution: StackDistribution) = "setDistribution:";
    pub fn arranged_subviews(&self) -> NSArray = "arrangedSubviews";
    // pub fn add_arranged_subview(&self, view: &NSView) = "addArrangedSubview:";
    fn insert_arranged_subview_at(&self, view: &NSView, index: isize) = "insertArrangedSubview:atIndex:";
    pub fn remove_arranged_subview(&self, view: &NSView) = "removeArrangedSubview:";
    pub fn set_detaches_hidden_views(&self, flag: bool) = "setDetachesHiddenViews:";
    pub fn set_hugging_priority(&self, priority: f32, orientation: Orientation) = "setHuggingPriority:forOrientation:";
    // pub fn set_custom_spacing_after(&self, spacing: f64, view: &NSView) = "setCustomSpacing:afterView:";
}}

impl NSStackView {
    /// `index` is an `NSInteger` in the header; past `isize::MAX` it is out of range either way.
    pub(crate) fn insert_arranged_subview(&self, view: &NSView, index: usize) {
        self.insert_arranged_subview_at(view, isize::try_from(index).unwrap_or(isize::MAX));
    }
}

objc_class!(pub struct NSClipView: NSView = "NSClipView");
objc_methods! { impl NSClipView {
    pub fn init_with_frame(this: Allocated<Self>, frame: Rect) -> Retained<NSClipView> = "initWithFrame:";
    pub fn set_draws_background(&self, flag: bool) = "setDrawsBackground:";
}}

objc_class!(pub struct NSScrollView: NSView = "NSScrollView");
objc_methods! { impl NSScrollView {
    pub fn init_with_frame(this: Allocated<Self>, frame: Rect) -> Retained<NSScrollView> = "initWithFrame:";
    pub fn set_document_view(&self, view: Option<&NSView>) = "setDocumentView:";
    pub fn document_view(&self) -> Option<NSView> = "documentView";
    pub fn set_content_view(&self, clip: &NSClipView) = "setContentView:";
    pub fn content_view(&self) -> NSClipView = "contentView";
    pub fn set_has_vertical_scroller(&self, flag: bool) = "setHasVerticalScroller:";
    pub fn set_has_horizontal_scroller(&self, flag: bool) = "setHasHorizontalScroller:";
    pub fn set_autohides_scrollers(&self, flag: bool) = "setAutohidesScrollers:";
    pub fn set_border_type(&self, border: BorderType) = "setBorderType:";
    pub fn set_draws_background(&self, flag: bool) = "setDrawsBackground:";
}}

objc_class!(pub struct NSSplitView: NSView = "NSSplitView");
objc_methods! { impl NSSplitView {
    pub fn init_with_frame(this: Allocated<Self>, frame: Rect) -> Retained<NSSplitView> = "initWithFrame:";
    pub fn set_vertical(&self, flag: bool) = "setVertical:";
    pub fn set_divider_style(&self, style: SplitViewDividerStyle) = "setDividerStyle:";
    pub fn set_arranges_all_subviews(&self, flag: bool) = "setArrangesAllSubviews:";
    pub fn arranged_subviews(&self) -> NSArray = "arrangedSubviews";
    fn insert_arranged_subview_at(&self, view: &NSView, index: isize) = "insertArrangedSubview:atIndex:";
    pub fn remove_arranged_subview(&self, view: &NSView) = "removeArrangedSubview:";
    // pub fn set_position_of_divider(&self, position: f64, index: isize) = "setPosition:ofDividerAtIndex:";
    pub fn set_holding_priority(&self, priority: f32, index: isize) = "setHoldingPriority:forSubviewAtIndex:";
}}

impl NSSplitView {
    /// As [`NSStackView::insert_arranged_subview`].
    pub(crate) fn insert_arranged_subview(&self, view: &NSView, index: usize) {
        self.insert_arranged_subview_at(view, isize::try_from(index).unwrap_or(isize::MAX));
    }
}

objc_class!(pub struct NSBox: NSView = "NSBox");
objc_methods! { impl NSBox {
    pub fn init_with_frame(this: Allocated<Self>, frame: Rect) -> Retained<NSBox> = "initWithFrame:";
    pub fn set_box_type(&self, kind: BoxType) = "setBoxType:";
    pub fn set_title(&self, title: &NSString) = "setTitle:";
    pub fn set_title_position(&self, position: TitlePosition) = "setTitlePosition:";
    // pub fn set_content_view(&self, view: Option<&NSView>) = "setContentView:";
    pub fn content_view(&self) -> Option<NSView> = "contentView";
    // pub fn set_content_view_margins(&self, size: Size) = "setContentViewMargins:";
    // pub fn set_transparent(&self, flag: bool) = "setTransparent:";
    // pub fn set_fill_color(&self, color: &NSColor) = "setFillColor:";
}}

// ───────────────────────────── controls ────────────────────────────────────

objc_class!(pub struct NSControl: NSView = "NSControl");
objc_methods! { impl NSControl {
    pub fn set_target(&self, target: Option<&NSObject>) = "setTarget:";
    pub fn set_action(&self, action: Option<Sel>) = "setAction:";
    pub fn set_enabled(&self, enabled: bool) = "setEnabled:";
    // pub fn is_enabled(&self) -> bool = "isEnabled";
    pub fn set_string_value(&self, value: &NSString) = "setStringValue:";
    pub fn string_value(&self) -> NSString = "stringValue";
    pub fn set_double_value(&self, value: f64) = "setDoubleValue:";
    pub fn double_value(&self) -> f64 = "doubleValue";
    // pub fn set_integer_value(&self, value: isize) = "setIntegerValue:";
    // pub fn integer_value(&self) -> isize = "integerValue";
    pub fn set_font(&self, font: Option<&NSFont>) = "setFont:";
    pub fn set_alignment(&self, alignment: TextAlignment) = "setAlignment:";
    // pub fn set_control_size(&self, size: ControlSize) = "setControlSize:";
    pub fn set_continuous(&self, flag: bool) = "setContinuous:";
    // pub fn size_to_fit(&self) = "sizeToFit";
    pub fn perform_click(&self, sender: Option<&NSObject>) = "performClick:";
    // pub fn set_tag(&self, tag: isize) = "setTag:";
    // pub fn tag(&self) -> isize = "tag";
    pub fn set_line_break_mode(&self, mode: LineBreakMode) = "setLineBreakMode:";
    pub fn set_uses_single_line_mode(&self, flag: bool) = "setUsesSingleLineMode:";
    pub fn cell(&self) -> Option<NSCell> = "cell";
    // pub fn current_editor(&self) -> Option<NSTextView> = "currentEditor";
}}

objc_class!(pub struct NSCell: NSObject = "NSCell");
objc_methods! { impl NSCell {
    pub fn set_scrollable(&self, flag: bool) = "setScrollable:";
    // pub fn set_wraps(&self, flag: bool) = "setWraps:";
    pub fn set_truncates_last_visible_line(&self, flag: bool) = "setTruncatesLastVisibleLine:";
    pub fn set_sends_action_on_end_editing(&self, flag: bool) = "setSendsActionOnEndEditing:";
    pub fn perform_click(&self, sender: Option<&NSObject>) = "performClick:";
}}

objc_class!(pub struct NSTextField: NSControl = "NSTextField");
objc_methods! { impl NSTextField {
    pub fn init_with_frame(this: Allocated<Self>, frame: Rect) -> Retained<NSTextField> = "initWithFrame:";
    pub fn label(text: &NSString) -> NSTextField = "labelWithString:";
    // pub fn wrapping_label(text: &NSString) -> NSTextField = "wrappingLabelWithString:";
    // pub fn editable(text: &NSString) -> NSTextField = "textFieldWithString:";
    pub fn set_text_color(&self, color: Option<&NSColor>) = "setTextColor:";
    pub fn set_placeholder_string(&self, text: Option<&NSString>) = "setPlaceholderString:";
    pub fn set_editable(&self, flag: bool) = "setEditable:";
    pub fn set_selectable(&self, flag: bool) = "setSelectable:";
    pub fn set_bezeled(&self, flag: bool) = "setBezeled:";
    // pub fn set_bordered(&self, flag: bool) = "setBordered:";
    pub fn set_draws_background(&self, flag: bool) = "setDrawsBackground:";
    // pub fn set_background_color(&self, color: Option<&NSColor>) = "setBackgroundColor:";
    pub fn set_maximum_number_of_lines(&self, lines: isize) = "setMaximumNumberOfLines:";
    // pub fn set_preferred_max_layout_width(&self, width: f64) = "setPreferredMaxLayoutWidth:";
    pub fn set_delegate(&self, delegate: Option<&NSObject>) = "setDelegate:";
    // pub fn select_text(&self, sender: Option<&NSObject>) = "selectText:";
    // pub fn set_allows_editing_text_attributes(&self, flag: bool) = "setAllowsEditingTextAttributes:";
}}

objc_class!(pub struct NSSecureTextField: NSTextField = "NSSecureTextField");
objc_methods! { impl NSSecureTextField {
    pub fn init_with_frame(this: Allocated<Self>, frame: Rect) -> Retained<NSSecureTextField> = "initWithFrame:";
}}

objc_class!(pub struct NSSearchField: NSTextField = "NSSearchField");
objc_methods! { impl NSSearchField {
    pub fn init_with_frame(this: Allocated<Self>, frame: Rect) -> Retained<NSSearchField> = "initWithFrame:";
    // pub fn set_sends_search_string_immediately(&self, flag: bool) = "setSendsSearchStringImmediately:";
    pub fn set_sends_whole_search_string(&self, flag: bool) = "setSendsWholeSearchString:";
}}

objc_class!(pub struct NSButton: NSControl = "NSButton");
objc_methods! { impl NSButton {
    pub fn with_title(title: &NSString, target: Option<&NSObject>, action: Option<Sel>) -> NSButton = "buttonWithTitle:target:action:";
    pub fn checkbox(title: &NSString, target: Option<&NSObject>, action: Option<Sel>) -> NSButton = "checkboxWithTitle:target:action:";
    pub fn radio(title: &NSString, target: Option<&NSObject>, action: Option<Sel>) -> NSButton = "radioButtonWithTitle:target:action:";
    pub fn set_title(&self, title: &NSString) = "setTitle:";
    pub fn title(&self) -> NSString = "title";
    pub fn set_bezel_style(&self, style: BezelStyle) = "setBezelStyle:";
    pub fn set_bordered(&self, flag: bool) = "setBordered:";
    pub fn set_key_equivalent(&self, key: &NSString) = "setKeyEquivalent:";
    // pub fn set_key_equivalent_modifier_mask(&self, mask: usize) = "setKeyEquivalentModifierMask:";
    pub fn set_state(&self, state: ControlStateValue) = "setState:";
    pub fn state(&self) -> isize = "state";
    pub fn set_image(&self, image: Option<&NSImage>) = "setImage:";
    pub fn set_image_position(&self, position: CellImagePosition) = "setImagePosition:";
    // pub fn set_image_scaling(&self, scaling: ImageScaling) = "setImageScaling:";
    pub fn set_content_tint_color(&self, color: Option<&NSColor>) = "setContentTintColor:";
    // pub fn set_bezel_color(&self, color: Option<&NSColor>) = "setBezelColor:";
    pub fn set_has_destructive_action(&self, flag: bool) = "setHasDestructiveAction:";
    // pub fn set_shows_border_only_while_mouse_inside(&self, flag: bool) = "setShowsBorderOnlyWhileMouseInside:";
    // pub fn set_allows_mixed_state(&self, flag: bool) = "setAllowsMixedState:";
}}

objc_class!(pub struct NSSwitch: NSControl = "NSSwitch");
objc_methods! { impl NSSwitch {
    pub fn init_with_frame(this: Allocated<Self>, frame: Rect) -> Retained<NSSwitch> = "initWithFrame:";
    pub fn set_state(&self, state: ControlStateValue) = "setState:";
    pub fn state(&self) -> isize = "state";
}}

objc_class!(pub struct NSSlider: NSControl = "NSSlider");
objc_methods! { impl NSSlider {
    pub fn with_value(value: f64, min: f64, max: f64, target: Option<&NSObject>, action: Option<Sel>) -> NSSlider
        = "sliderWithValue:minValue:maxValue:target:action:";
    pub fn set_min_value(&self, value: f64) = "setMinValue:";
    pub fn min_value(&self) -> f64 = "minValue";
    pub fn set_max_value(&self, value: f64) = "setMaxValue:";
    pub fn max_value(&self) -> f64 = "maxValue";
    pub fn set_number_of_tick_marks(&self, count: isize) = "setNumberOfTickMarks:";
    pub fn set_allows_tick_mark_values_only(&self, flag: bool) = "setAllowsTickMarkValuesOnly:";
    // pub fn set_vertical(&self, flag: bool) = "setVertical:";
}}

objc_class!(pub struct NSPopUpButton: NSButton = "NSPopUpButton");
objc_methods! { impl NSPopUpButton {
    pub fn init_pulls_down(this: Allocated<Self>, frame: Rect, pulls_down: bool) -> Retained<NSPopUpButton> = "initWithFrame:pullsDown:";
    pub fn remove_all_items(&self) = "removeAllItems";
    pub fn menu(&self) -> Option<NSMenu> = "menu";
    pub fn select_item_at(&self, index: isize) = "selectItemAtIndex:";
    pub fn index_of_selected_item(&self) -> isize = "indexOfSelectedItem";
    pub fn number_of_items(&self) -> isize = "numberOfItems";
}}

objc_class!(pub struct NSSegmentedControl: NSControl = "NSSegmentedControl");
objc_methods! { impl NSSegmentedControl {
    pub fn with_labels(labels: &NSArray, tracking: SegmentSwitchTracking, target: Option<&NSObject>, action: Option<Sel>) -> NSSegmentedControl
        = "segmentedControlWithLabels:trackingMode:target:action:";
    pub fn set_segment_count(&self, count: isize) = "setSegmentCount:";
    pub fn segment_count(&self) -> isize = "segmentCount";
    pub fn set_label_for_segment(&self, label: &NSString, segment: isize) = "setLabel:forSegment:";
    pub fn set_width_for_segment(&self, width: f64, segment: isize) = "setWidth:forSegment:";
    /// `-1` deselects every segment.
    pub fn set_selected_segment(&self, segment: isize) = "setSelectedSegment:";
    pub fn selected_segment(&self) -> isize = "selectedSegment";
    // pub fn set_selected_for_segment(&self, selected: bool, segment: isize) = "setSelected:forSegment:";
    // pub fn set_tracking_mode(&self, mode: SegmentSwitchTracking) = "setTrackingMode:";
    pub fn set_segment_distribution(&self, distribution: SegmentDistribution) = "setSegmentDistribution:";
}}

objc_class!(pub struct NSProgressIndicator: NSView = "NSProgressIndicator");
objc_methods! { impl NSProgressIndicator {
    pub fn init_with_frame(this: Allocated<Self>, frame: Rect) -> Retained<NSProgressIndicator> = "initWithFrame:";
    pub fn set_indeterminate(&self, flag: bool) = "setIndeterminate:";
    pub fn set_style(&self, style: ProgressIndicatorStyle) = "setStyle:";
    pub fn set_double_value(&self, value: f64) = "setDoubleValue:";
    pub fn set_min_value(&self, value: f64) = "setMinValue:";
    pub fn set_max_value(&self, value: f64) = "setMaxValue:";
    pub fn start_animation(&self, sender: Option<&NSObject>) = "startAnimation:";
    pub fn stop_animation(&self, sender: Option<&NSObject>) = "stopAnimation:";
    // pub fn set_uses_threaded_animation(&self, flag: bool) = "setUsesThreadedAnimation:";
    pub fn set_displayed_when_stopped(&self, flag: bool) = "setDisplayedWhenStopped:";
    pub fn set_control_size(&self, size: ControlSize) = "setControlSize:";
}}

objc_class!(pub struct NSImage: NSObject = "NSImage");
objc_methods! { impl NSImage {
    pub fn system_symbol(name: &NSString, accessibility_description: Option<&NSString>) -> Option<NSImage>
        = "imageWithSystemSymbolName:accessibilityDescription:";
    // pub fn named(name: &NSString) -> Option<NSImage> = "imageNamed:";
    pub fn init_with_contents_of_file(this: Allocated<Self>, path: &NSString) -> Retained<Option<NSImage>> = "initWithContentsOfFile:";
    pub fn init_with_data(this: Allocated<Self>, data: &NSData) -> Retained<Option<NSImage>> = "initWithData:";
    // pub fn with_symbol_configuration(&self, configuration: &NSImageSymbolConfiguration) -> Option<NSImage> = "imageWithSymbolConfiguration:";
    // pub fn set_size(&self, size: Size) = "setSize:";
    // pub fn size(&self) -> Size = "size";
    // pub fn set_template(&self, flag: bool) = "setTemplate:";
}}

objc_class!(pub struct NSImageSymbolConfiguration: NSObject = "NSImageSymbolConfiguration");
objc_methods! { impl NSImageSymbolConfiguration {
    pub fn with_point_size(size: f64, weight: f64) -> NSImageSymbolConfiguration = "configurationWithPointSize:weight:";
}}

objc_class!(pub struct NSImageView: NSControl = "NSImageView");
objc_methods! { impl NSImageView {
    pub fn init_with_frame(this: Allocated<Self>, frame: Rect) -> Retained<NSImageView> = "initWithFrame:";
    pub fn set_image(&self, image: Option<&NSImage>) = "setImage:";
    // pub fn image(&self) -> Option<NSImage> = "image";
    pub fn set_image_scaling(&self, scaling: ImageScaling) = "setImageScaling:";
    pub fn set_content_tint_color(&self, color: Option<&NSColor>) = "setContentTintColor:";
    pub fn set_symbol_configuration(&self, configuration: Option<&NSImageSymbolConfiguration>) = "setSymbolConfiguration:";
    pub fn set_editable(&self, flag: bool) = "setEditable:";
}}

// ─────────────────────────────── text views ────────────────────────────────

objc_class!(pub struct NSTextView: NSView = "NSTextView");
objc_methods! { impl NSTextView {
    /// An NSScrollView whose document is a ready-configured NSTextView (10.14+).
    pub fn scrollable_text_view() -> NSScrollView = "scrollableTextView";
    pub fn set_string(&self, string: &NSString) = "setString:";
    pub fn string(&self) -> NSString = "string";
    pub fn set_editable(&self, flag: bool) = "setEditable:";
    // pub fn set_selectable(&self, flag: bool) = "setSelectable:";
    pub fn set_rich_text(&self, flag: bool) = "setRichText:";
    pub fn set_font(&self, font: Option<&NSFont>) = "setFont:";
    pub fn set_text_color(&self, color: Option<&NSColor>) = "setTextColor:";
    pub fn set_delegate(&self, delegate: Option<&NSObject>) = "setDelegate:";
    pub fn set_automatic_quote_substitution_enabled(&self, flag: bool) = "setAutomaticQuoteSubstitutionEnabled:";
    pub fn set_automatic_dash_substitution_enabled(&self, flag: bool) = "setAutomaticDashSubstitutionEnabled:";
    pub fn set_automatic_text_replacement_enabled(&self, flag: bool) = "setAutomaticTextReplacementEnabled:";
    pub fn set_allows_undo(&self, flag: bool) = "setAllowsUndo:";
    pub fn break_undo_coalescing(&self) = "breakUndoCoalescing";
    pub fn undo_manager(&self) -> Option<NSUndoManager> = "undoManager";
    // pub fn set_text_container_inset(&self, inset: Size) = "setTextContainerInset:";
    // pub fn set_draws_background(&self, flag: bool) = "setDrawsBackground:";
    pub fn set_uses_adaptive_color_mapping_for_dark_appearance(&self, flag: bool) = "setUsesAdaptiveColorMappingForDarkAppearance:";
}}

objc_class!(pub struct NSUndoManager: NSObject = "NSUndoManager");
objc_methods! { impl NSUndoManager {
    pub fn new() -> Retained<NSUndoManager> = "new";
    pub fn remove_all_actions(&self) = "removeAllActions";
}}

// ─────────────────────────────── tables ────────────────────────────────────

objc_class!(pub struct NSTableView: NSControl = "NSTableView");
objc_methods! { impl NSTableView {
    pub fn init_with_frame(this: Allocated<Self>, frame: Rect) -> Retained<NSTableView> = "initWithFrame:";
    pub fn add_table_column(&self, column: &NSTableColumn) = "addTableColumn:";
    pub fn remove_table_column(&self, column: &NSTableColumn) = "removeTableColumn:";
    // pub fn table_columns(&self) -> NSArray = "tableColumns";
    pub fn set_header_view(&self, header: Option<&NSView>) = "setHeaderView:";
    pub fn header_view(&self) -> Option<NSView> = "headerView";
    pub fn set_data_source(&self, source: Option<&NSObject>) = "setDataSource:";
    pub fn set_delegate(&self, delegate: Option<&NSObject>) = "setDelegate:";
    pub fn reload_data(&self) = "reloadData";
    // pub fn note_number_of_rows_changed(&self) = "noteNumberOfRowsChanged";
    // pub fn number_of_rows(&self) -> isize = "numberOfRows";
    pub fn row_height(&self) -> f64 = "rowHeight";
    pub fn set_row_height(&self, height: f64) = "setRowHeight:";
    pub fn set_uses_alternating_row_background_colors(&self, flag: bool) = "setUsesAlternatingRowBackgroundColors:";
    pub fn set_allows_multiple_selection(&self, flag: bool) = "setAllowsMultipleSelection:";
    pub fn allows_multiple_selection(&self) -> bool = "allowsMultipleSelection";
    pub fn set_allows_empty_selection(&self, flag: bool) = "setAllowsEmptySelection:";
    pub fn set_allows_column_reordering(&self, flag: bool) = "setAllowsColumnReordering:";
    pub fn selected_row_indexes(&self) -> NSIndexSet = "selectedRowIndexes";
    pub fn select_row_indexes(&self, indexes: &NSIndexSet, extend: bool) = "selectRowIndexes:byExtendingSelection:";
    pub fn set_double_action(&self, action: Option<Sel>) = "setDoubleAction:";
    pub fn clicked_row(&self) -> isize = "clickedRow";
    pub fn make_view_with_identifier(&self, identifier: &NSString, owner: Option<&NSObject>) -> Option<NSView> = "makeViewWithIdentifier:owner:";
    pub fn set_column_autoresizing_style(&self, style: ColumnAutoresizingStyle) = "setColumnAutoresizingStyle:";
    // pub fn set_grid_style_mask(&self, mask: usize) = "setGridStyleMask:";
    // pub fn set_intercell_spacing(&self, size: Size) = "setIntercellSpacing:";
    // pub fn scroll_row_to_visible(&self, row: isize) = "scrollRowToVisible:";
    // pub fn size_last_column_to_fit(&self) = "sizeLastColumnToFit";
}}

objc_class!(pub struct NSTableColumn: NSObject = "NSTableColumn");
objc_methods! { impl NSTableColumn {
    pub fn init_with_identifier(this: Allocated<Self>, identifier: &NSString) -> Retained<NSTableColumn> = "initWithIdentifier:";
    // pub fn identifier(&self) -> NSString = "identifier";
    pub fn set_title(&self, title: &NSString) = "setTitle:";
    pub fn set_width(&self, width: f64) = "setWidth:";
    // pub fn width(&self) -> f64 = "width";
    // pub fn set_min_width(&self, width: f64) = "setMinWidth:";
    pub fn set_resizing_mask(&self, mask: usize) = "setResizingMask:";
    pub fn set_editable(&self, flag: bool) = "setEditable:";
}}

objc_class!(pub struct NSTableCellView: NSView = "NSTableCellView");
objc_methods! { impl NSTableCellView {
    pub fn init_with_frame(this: Allocated<Self>, frame: Rect) -> Retained<NSTableCellView> = "initWithFrame:";
    pub fn set_text_field(&self, field: Option<&NSTextField>) = "setTextField:";
    pub fn text_field(&self) -> Option<NSTextField> = "textField";
}}

// ───────────────────────────── colours, fonts ──────────────────────────────

objc_class!(pub struct NSColor: NSObject = "NSColor");
objc_methods! { impl NSColor {
    pub fn srgb(red: f64, green: f64, blue: f64, alpha: f64) -> NSColor = "colorWithSRGBRed:green:blue:alpha:";
    /// A new reference; the colour AppKit returns is only owned by the current autorelease pool.
    pub fn cg_color(&self) -> CGColor = "CGColor";
    /// nil when the colour has no component form in `space` (patterns). Dynamic colours resolve for the current appearance.
    pub fn color_using_color_space(&self, space: &NSColorSpace) -> Option<NSColor> = "colorUsingColorSpace:";
    /// These three raise unless the colour's space has an RGB model; convert with `color_using_color_space` first.
    pub fn red_component(&self) -> f64 = "redComponent";
    pub fn green_component(&self) -> f64 = "greenComponent";
    pub fn blue_component(&self) -> f64 = "blueComponent";
    pub fn alpha_component(&self) -> f64 = "alphaComponent";
    pub fn label_color() -> NSColor = "labelColor";
    pub fn secondary_label_color() -> NSColor = "secondaryLabelColor";
    pub fn tertiary_label_color() -> NSColor = "tertiaryLabelColor";
    pub fn quaternary_label_color() -> NSColor = "quaternaryLabelColor";
    pub fn text_color() -> NSColor = "textColor";
    pub fn placeholder_text_color() -> NSColor = "placeholderTextColor";
    pub fn link_color() -> NSColor = "linkColor";
    pub fn separator_color() -> NSColor = "separatorColor";
    pub fn control_accent_color() -> NSColor = "controlAccentColor";
    pub fn control_color() -> NSColor = "controlColor";
    pub fn control_text_color() -> NSColor = "controlTextColor";
    pub fn control_background_color() -> NSColor = "controlBackgroundColor";
    pub fn window_background_color() -> NSColor = "windowBackgroundColor";
    pub fn under_page_background_color() -> NSColor = "underPageBackgroundColor";
    pub fn text_background_color() -> NSColor = "textBackgroundColor";
    pub fn selected_content_background_color() -> NSColor = "selectedContentBackgroundColor";
    pub fn clear_color() -> NSColor = "clearColor";
    pub fn black_color() -> NSColor = "blackColor";
    pub fn white_color() -> NSColor = "whiteColor";
    pub fn system_gray_color() -> NSColor = "systemGrayColor";
    pub fn system_red_color() -> NSColor = "systemRedColor";
    pub fn system_orange_color() -> NSColor = "systemOrangeColor";
    pub fn system_yellow_color() -> NSColor = "systemYellowColor";
    pub fn system_green_color() -> NSColor = "systemGreenColor";
    pub fn system_mint_color() -> NSColor = "systemMintColor";
    pub fn system_teal_color() -> NSColor = "systemTealColor";
    pub fn system_cyan_color() -> NSColor = "systemCyanColor";
    pub fn system_blue_color() -> NSColor = "systemBlueColor";
    pub fn system_indigo_color() -> NSColor = "systemIndigoColor";
    pub fn system_purple_color() -> NSColor = "systemPurpleColor";
    pub fn system_pink_color() -> NSColor = "systemPinkColor";
    pub fn system_brown_color() -> NSColor = "systemBrownColor";
}}

objc_class!(pub struct NSColorSpace: NSObject = "NSColorSpace");
objc_methods! { impl NSColorSpace {
    pub fn srgb() -> NSColorSpace = "sRGBColorSpace";
}}

objc_class!(pub struct NSFont: NSObject = "NSFont");
objc_methods! { impl NSFont {
    // pub fn system(size: f64) -> NSFont = "systemFontOfSize:";
    pub fn system_weighted(size: f64, weight: f64) -> NSFont = "systemFontOfSize:weight:";
    // pub fn bold_system(size: f64) -> NSFont = "boldSystemFontOfSize:";
    pub fn monospaced_system(size: f64, weight: f64) -> NSFont = "monospacedSystemFontOfSize:weight:";
    // pub fn monospaced_digit_system(size: f64, weight: f64) -> NSFont = "monospacedDigitSystemFontOfSize:weight:";
    // pub fn with_name(name: &NSString, size: f64) -> Option<NSFont> = "fontWithName:size:";
    pub fn with_descriptor(descriptor: &NSFontDescriptor, size: f64) -> Option<NSFont> = "fontWithDescriptor:size:";
    pub fn font_descriptor(&self) -> NSFontDescriptor = "fontDescriptor";
    // pub fn point_size(&self) -> f64 = "pointSize";
    pub fn system_font_size() -> f64 = "systemFontSize";
}}

objc_class!(pub struct NSFontDescriptor: NSObject = "NSFontDescriptor");
objc_methods! { impl NSFontDescriptor {
    pub fn with_design(&self, design: &NSString) -> Option<NSFontDescriptor> = "fontDescriptorWithDesign:";
    pub fn with_symbolic_traits(&self, traits: u32) -> NSFontDescriptor = "fontDescriptorWithSymbolicTraits:";
    pub fn symbolic_traits(&self) -> u32 = "symbolicTraits";
}}

impl NSFontDescriptor {
    objc_global!(pub(crate) fn system_design_rounded() -> NSString = "NSFontDescriptorSystemDesignRounded");
    objc_global!(pub(crate) fn system_design_serif() -> NSString = "NSFontDescriptorSystemDesignSerif");
}

// ───────────────────────────── panels (async) ──────────────────────────────

// objc_class!(pub struct NSAlert: NSObject = "NSAlert");
// objc_methods! { impl NSAlert {
// pub fn new() -> Retained<NSAlert> = "new";
// pub fn set_message_text(&self, text: &NSString) = "setMessageText:";
// pub fn set_informative_text(&self, text: &NSString) = "setInformativeText:";
// pub fn add_button_with_title(&self, title: &NSString) -> NSButton = "addButtonWithTitle:";
// pub fn window(&self) -> NSWindow = "window";
// }}
// objc_class!(pub struct NSSavePanel: NSWindow = "NSSavePanel");
// objc_methods! { impl NSSavePanel {
// pub fn save_panel() -> NSSavePanel = "savePanel";
// pub fn set_message(&self, text: &NSString) = "setMessage:";
// pub fn set_prompt(&self, text: &NSString) = "setPrompt:";
// pub fn set_name_field_string_value(&self, text: &NSString) = "setNameFieldStringValue:";
// pub fn set_directory_url(&self, url: Option<&NSURL>) = "setDirectoryURL:";
// pub fn set_can_create_directories(&self, flag: bool) = "setCanCreateDirectories:";
// pub fn url(&self) -> Option<NSURL> = "URL";
// }}
// objc_class!(pub struct NSOpenPanel: NSSavePanel = "NSOpenPanel");
// objc_methods! { impl NSOpenPanel {
// pub fn open_panel() -> NSOpenPanel = "openPanel";
// pub fn set_can_choose_files(&self, flag: bool) = "setCanChooseFiles:";
// pub fn set_can_choose_directories(&self, flag: bool) = "setCanChooseDirectories:";
// pub fn set_allows_multiple_selection(&self, flag: bool) = "setAllowsMultipleSelection:";
// pub fn urls(&self) -> NSArray = "URLs";
// }}
