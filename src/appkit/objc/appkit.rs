//! AppKit bindings. One line per method: the Rust signature on the left is a
//! transcription of the Objective-C one named on the right. `isize`/`usize`
//! are `NSInteger`/`NSUInteger`, `f64` is `CGFloat`, `bool` is `BOOL`,
//! `Option<&T>` is a nullable object argument. Object returns: `T` is a +0
//! nonnull return, `Option<T>` +0 nullable, `Retained<T>` +1 nonnull and
//! `Retained<Option<T>>` +1 nullable (both `Retained` forms yield `T` /
//! `Option<T>` from the generated method). Nullability follows Apple's headers.

use super::foundation::{NSArray, NSDate, NSObject, NSString};
use super::{objc_class, objc_methods};
use crate::geometry::{Point, Rect};

// ───────────────────────────── application ─────────────────────────────────

objc_class!(pub struct NSApplication: NSObject = "NSApplication");
objc_methods! { impl NSApplication {
    pub fn shared() -> NSApplication = "sharedApplication";
    // pub fn set_activation_policy(&self, policy: isize) -> bool = "setActivationPolicy:";
    // pub fn activate_ignoring_other_apps(&self, flag: bool) = "activateIgnoringOtherApps:";
    pub fn finish_launching(&self) = "finishLaunching";
    pub fn run(&self) = "run";
    pub fn stop(&self, sender: Option<&NSObject>) = "stop:";
    // pub fn terminate(&self, sender: Option<&NSObject>) = "terminate:";
    pub fn is_running(&self) -> bool = "isRunning";
    // pub fn hide(&self, sender: Option<&NSObject>) = "hide:";
    // pub fn unhide(&self, sender: Option<&NSObject>) = "unhide:";
    pub fn next_event(&self, mask: u64, until: Option<&NSDate>, mode: &NSString, dequeue: bool) -> Option<NSEvent>
        = "nextEventMatchingMask:untilDate:inMode:dequeue:";
    // pub fn send_event(&self, event: &NSEvent) = "sendEvent:";
    pub fn post_event(&self, event: &NSEvent, at_start: bool) = "postEvent:atStart:";
    // pub fn update_windows(&self) = "updateWindows";
    pub fn set_delegate(&self, delegate: Option<&NSObject>) = "setDelegate:";
    // pub fn set_main_menu(&self, menu: Option<&NSMenu>) = "setMainMenu:";
    // pub fn set_windows_menu(&self, menu: Option<&NSMenu>) = "setWindowsMenu:";
    // pub fn set_services_menu(&self, menu: Option<&NSMenu>) = "setServicesMenu:";
    // pub fn dock_tile(&self) -> NSDockTile = "dockTile";
    // pub fn effective_appearance(&self) -> NSAppearance = "effectiveAppearance";
    // pub fn windows(&self) -> NSArray = "windows";
    // pub fn current_event(&self) -> Option<NSEvent> = "currentEvent";
    // pub fn key_window(&self) -> Option<NSWindow> = "keyWindow";
    // pub fn set_application_icon_image(&self, image: Option<&NSImage>) = "setApplicationIconImage:";
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

// ─────────────────────────────── windows ───────────────────────────────────

objc_class!(pub struct NSWindow: NSObject = "NSWindow");
objc_methods! { impl NSWindow {
    // pub fn init_with_content_rect(this: Allocated<Self>, rect: Rect, style_mask: usize, backing: BackingStoreType, defer: bool) -> Retained<NSWindow>
    //     = "initWithContentRect:styleMask:backing:defer:";
    pub fn set_released_when_closed(&self, flag: bool) = "setReleasedWhenClosed:";
    // pub fn set_delegate(&self, delegate: Option<&NSObject>) = "setDelegate:";
    // pub fn set_title(&self, title: &NSString) = "setTitle:";
    // pub fn title(&self) -> NSString = "title";
    // pub fn set_subtitle(&self, subtitle: &NSString) = "setSubtitle:";
    // pub fn set_content_view(&self, view: Option<&NSView>) = "setContentView:";
    pub fn content_view(&self) -> Option<NSView> = "contentView";
    // pub fn set_content_size(&self, size: Size) = "setContentSize:";
    // pub fn set_content_min_size(&self, size: Size) = "setContentMinSize:";
    // pub fn set_content_max_size(&self, size: Size) = "setContentMaxSize:";
    // pub fn content_rect_for_frame_rect(&self, frame: Rect) -> Rect = "contentRectForFrameRect:";
    // pub fn frame_rect_for_content_rect(&self, content: Rect) -> Rect = "frameRectForContentRect:";
    // pub fn frame(&self) -> Rect = "frame";
    // pub fn set_frame(&self, frame: Rect, display: bool) = "setFrame:display:";
    // pub fn set_frame_origin(&self, origin: Point) = "setFrameOrigin:";
    // pub fn set_frame_top_left_point(&self, point: Point) = "setFrameTopLeftPoint:";
    // pub fn set_style_mask(&self, mask: usize) = "setStyleMask:";
    // pub fn style_mask(&self) -> usize = "styleMask";
    // pub fn make_key_and_order_front(&self, sender: Option<&NSObject>) = "makeKeyAndOrderFront:";
    // pub fn order_front(&self, sender: Option<&NSObject>) = "orderFront:";
    // pub fn order_out(&self, sender: Option<&NSObject>) = "orderOut:";
    // pub fn center(&self) = "center";
    // pub fn close(&self) = "close";
    // pub fn perform_close(&self, sender: Option<&NSObject>) = "performClose:";
    // pub fn is_visible(&self) -> bool = "isVisible";
    // pub fn is_key_window(&self) -> bool = "isKeyWindow";
    // pub fn is_miniaturized(&self) -> bool = "isMiniaturized";
    // pub fn miniaturize(&self, sender: Option<&NSObject>) = "miniaturize:";
    // pub fn deminiaturize(&self, sender: Option<&NSObject>) = "deminiaturize:";
    // pub fn is_zoomed(&self) -> bool = "isZoomed";
    // pub fn zoom(&self, sender: Option<&NSObject>) = "zoom:";
    // pub fn toggle_full_screen(&self, sender: Option<&NSObject>) = "toggleFullScreen:";
    // pub fn set_titlebar_appears_transparent(&self, flag: bool) = "setTitlebarAppearsTransparent:";
    // pub fn set_title_visibility(&self, visibility: WindowTitleVisibility) = "setTitleVisibility:";
    // pub fn set_movable_by_window_background(&self, flag: bool) = "setMovableByWindowBackground:";
    // pub fn set_background_color(&self, color: Option<&NSColor>) = "setBackgroundColor:";
    // pub fn set_opaque(&self, flag: bool) = "setOpaque:";
    // pub fn set_has_shadow(&self, flag: bool) = "setHasShadow:";
    // pub fn set_level(&self, level: isize) = "setLevel:";
    // pub fn set_alpha_value(&self, alpha: f64) = "setAlphaValue:";
    // pub fn set_min_size(&self, size: Size) = "setMinSize:";
    // pub fn set_max_size(&self, size: Size) = "setMaxSize:";
    // pub fn set_frame_autosave_name(&self, name: &NSString) -> bool = "setFrameAutosaveName:";
    // pub fn set_collection_behavior(&self, behavior: usize) = "setCollectionBehavior:";
    // pub fn make_first_responder(&self, responder: Option<&NSView>) -> bool = "makeFirstResponder:";
    // pub fn set_initial_first_responder(&self, view: Option<&NSView>) = "setInitialFirstResponder:";
    // pub fn set_document_edited(&self, flag: bool) = "setDocumentEdited:";
    // pub fn set_represented_filename(&self, path: &NSString) = "setRepresentedFilename:";
    // pub fn screen(&self) -> Option<NSScreen> = "screen";
    // pub fn backing_scale_factor(&self) -> f64 = "backingScaleFactor";
    // pub fn set_appearance(&self, appearance: Option<&NSAppearance>) = "setAppearance:";
    // pub fn layout_if_needed(&self) = "layoutIfNeeded";
    // pub fn display_if_needed(&self) = "displayIfNeeded";
    // pub fn set_default_button_cell(&self, cell: Option<&NSCell>) = "setDefaultButtonCell:";
    // pub fn default_button_cell(&self) -> Option<NSCell> = "defaultButtonCell";
}}

// ─────────────────────────────── views ─────────────────────────────────────

objc_class!(pub struct NSView: NSObject = "NSView");
objc_methods! { impl NSView {
    pub fn init_with_frame(this: Allocated<Self>, frame: Rect) -> Retained<NSView> = "initWithFrame:";
    pub fn set_translates_autoresizing_mask(&self, flag: bool) = "setTranslatesAutoresizingMaskIntoConstraints:";
    // pub fn add_subview(&self, view: &NSView) = "addSubview:";
    // pub fn add_subview_positioned(&self, view: &NSView, place: WindowOrderingMode, relative_to: Option<&NSView>)
    //     = "addSubview:positioned:relativeTo:";
    // pub fn remove_from_superview(&self) = "removeFromSuperview";
    // pub fn is_descendant_of(&self, view: &NSView) -> bool = "isDescendantOf:";
    // pub fn superview(&self) -> Option<NSView> = "superview";
    // pub fn subviews(&self) -> NSArray = "subviews";
    pub fn window(&self) -> Option<NSWindow> = "window";
    // pub fn set_hidden(&self, hidden: bool) = "setHidden:";
    // pub fn is_hidden(&self) -> bool = "isHidden";
    // pub fn set_alpha_value(&self, alpha: f64) = "setAlphaValue:";
    // pub fn set_tool_tip(&self, text: Option<&NSString>) = "setToolTip:";
    // pub fn set_identifier(&self, identifier: Option<&NSString>) = "setIdentifier:";
    // pub fn identifier(&self) -> Option<NSString> = "identifier";
    // pub fn set_wants_layer(&self, flag: bool) = "setWantsLayer:";
    // pub fn layer(&self) -> Option<CALayer> = "layer";
    // pub fn frame(&self) -> Rect = "frame";
    // pub fn set_frame(&self, frame: Rect) = "setFrame:";
    // pub fn set_frame_size(&self, size: Size) = "setFrameSize:";
    // pub fn bounds(&self) -> Rect = "bounds";
    // pub fn fitting_size(&self) -> Size = "fittingSize";
    // pub fn intrinsic_content_size(&self) -> Size = "intrinsicContentSize";
    // pub fn content_hugging_priority(&self, orientation: Orientation) -> f32 = "contentHuggingPriorityForOrientation:";
    pub fn set_content_hugging_priority(&self, priority: f32, orientation: Orientation) = "setContentHuggingPriority:forOrientation:";
    // pub fn content_compression_resistance_priority(&self, orientation: Orientation) -> f32
    //     = "contentCompressionResistancePriorityForOrientation:";
    pub fn set_content_compression_resistance_priority(&self, priority: f32, orientation: Orientation)
        = "setContentCompressionResistancePriority:forOrientation:";
    // pub fn set_needs_display(&self, flag: bool) = "setNeedsDisplay:";
    // pub fn set_needs_layout(&self, flag: bool) = "setNeedsLayout:";
    pub fn layout_subtree_if_needed(&self) = "layoutSubtreeIfNeeded";
    // pub fn effective_appearance(&self) -> NSAppearance = "effectiveAppearance";
    // pub fn constraints(&self) -> NSArray = "constraints";
    // pub fn set_autoresizing_mask(&self, mask: usize) = "setAutoresizingMask:";
    // pub fn bitmap_image_rep_for_caching_display_in_rect(&self, rect: Rect) -> Option<NSBitmapImageRep>
    //     = "bitmapImageRepForCachingDisplayInRect:";
    // pub fn cache_display_in_rect(&self, rect: Rect, rep: &NSBitmapImageRep) = "cacheDisplayInRect:toBitmapImageRep:";
    // pub fn enclosing_scroll_view(&self) -> Option<NSScrollView> = "enclosingScrollView";
    // pub fn scroll_point(&self, point: Point) = "scrollPoint:";
}}

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

/// `NSLayoutPriority` values shared by the widgets.
pub(crate) mod priority {
    /// Lowest there is: gives way to everything (spacers, a divider's long axis, scroll views).
    pub(crate) const YIELDING: f32 = 1.0;
}

// ──────────────────────────────── images ───────────────────────────────────

objc_class!(pub struct NSBitmapImageRep: NSObject = "NSBitmapImageRep");
objc_methods! { impl NSBitmapImageRep {
    pub fn bytes_per_plane(&self) -> isize = "bytesPerPlane";
    pub fn number_of_planes(&self) -> isize = "numberOfPlanes";
}}

// ──────────────────────────────── colours ──────────────────────────────────

objc_class!(pub struct NSColorSpace: NSObject = "NSColorSpace");
objc_methods! { impl NSColorSpace {
    pub fn srgb() -> NSColorSpace = "sRGBColorSpace";
}}
