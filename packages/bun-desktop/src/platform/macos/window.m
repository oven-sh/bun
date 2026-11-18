// A window, and the view that fills it.
#import "bridge.h"
#import <objc/runtime.h>
#import <QuartzCore/QuartzCore.h>
#import <Quartz/Quartz.h>

@interface BunDesktopWindow : NSWindow
@end

@interface BunDesktopPanel : NSPanel
@end

@interface BunDesktopView ()
@property bool isFocusable;
@property (readonly) float frequency;
@end

static bool isFocusable(NSWindow* window) { return ((BunDesktopView*)window.delegate).isFocusable; }

@implementation BunDesktopWindow
- (BOOL)canBecomeKeyWindow { return isFocusable(self); }
- (BOOL)canBecomeMainWindow { return isFocusable(self) && self.isVisible; }
- (NSTimeInterval)animationResizeTime:(NSRect)frame { return self.isVisible ? [super animationResizeTime:frame] : 0; }
@end

@implementation BunDesktopPanel
- (BOOL)canBecomeKeyWindow { return isFocusable(self); }
- (BOOL)canBecomeMainWindow { return NO; }
@end

static NSMutableDictionary<NSNumber*, BunDesktopView*>* views;

static NSPasteboardType const draggedByPage = @"sh.bun.desktop.drag";

static uint8_t modifiersOf(NSEventModifierFlags flags)
{
    return (flags & NSEventModifierFlagShift ? 1 : 0) | (flags & NSEventModifierFlagControl ? 2 : 0) | (flags & NSEventModifierFlagOption ? 4 : 0)
        | (flags & NSEventModifierFlagCommand ? 8 : 0) | (flags & NSEventModifierFlagCapsLock ? 32 : 0);
}

static bool isShortcut(NSEvent* event) { return event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl); }

static uint32_t lastCharacter(NSString* string)
{
    NSUInteger length = string.length;
    unichar last = [string characterAtIndex:length - 1], before = length > 1 ? [string characterAtIndex:length - 2] : 0;
    return CFStringIsSurrogateHighCharacter(before) ? CFStringGetLongCharacterForSurrogatePair(before, last) : last;
}

static void reportKey(NSEvent* event)
{
    NSString* characters = isShortcut(event) ? event.charactersIgnoringModifiers : event.characters;
    if (isShortcut(event) && !(characters.length && lastCharacter(characters) < 0x80)) {
        // Shortcuts have Latin names, whatever the keyboard types.
        NSString* latin = [event charactersByApplyingModifiers:NSEventModifierFlagCommand];
        if (latin.length && lastCharacter(latin) < 0x80)
            characters = event.modifierFlags & NSEventModifierFlagShift ? latin.uppercaseString : latin;
    }
    uint32_t symbol = characters.length ? lastCharacter(characters) : UINT32_MAX;
    bd_raw_key(event.type == NSEventTypeKeyDown, event.isARepeat, event.keyCode, symbol, modifiersOf(event.modifierFlags));
}

static BDRange toRange(NSRange range)
{
    return range.location == NSNotFound ? (BDRange) { -1, -1 } : (BDRange) { range.location, NSMaxRange(range) };
}

static NSRange fromRange(BDRange range)
{
    return range.start < 0 ? NSMakeRange(NSNotFound, 0) : NSMakeRange(range.start, range.end - range.start);
}

static NSString* plain(id string) { return [string isKindOfClass:NSAttributedString.class] ? [string string] : string; }

static NSCursor* diagonal(bool falls)
{
    if ([NSCursor respondsToSelector:@selector(frameResizeCursorFromPosition:inDirections:)])
        return [NSCursor frameResizeCursorFromPosition:falls ? NSCursorFrameResizePositionBottomRight : NSCursorFrameResizePositionBottomLeft
                                          inDirections:NSCursorFrameResizeDirectionsAll];
    NSImage* image = [NSImage imageWithSize:NSMakeSize(18, 18) flipped:falls drawingHandler:^BOOL(NSRect rect) {
        static const NSPoint corners[] = { { 3, 3 }, { 9, 3 }, { 6.8, 5.2 }, { 12.8, 11.2 }, { 15, 9 }, { 15, 15 }, { 9, 15 }, { 11.2, 12.8 }, { 5.2, 6.8 }, { 3, 9 } };
        NSBezierPath* arrows = [NSBezierPath bezierPath];
        [arrows appendBezierPathWithPoints:(NSPointArray)corners count:10];
        [arrows closePath];
        arrows.lineWidth = 2;
        [NSColor.whiteColor setStroke];
        [arrows stroke];
        [NSColor.blackColor setFill];
        [arrows fill];
        return YES;
    }];
    return [[NSCursor alloc] initWithImage:image hotSpot:NSMakePoint(9, 9)];
}

/// In the order of `platform::Cursor`.
static NSCursor* cursorAt(uint8_t index)
{
    static NSArray* cursors;
    cursors = cursors ?: @[
        NSCursor.arrowCursor, NSCursor.IBeamCursor, NSCursor.IBeamCursorForVerticalLayout, NSCursor.crosshairCursor,
        NSCursor.openHandCursor, NSCursor.closedHandCursor, NSCursor.pointingHandCursor, NSCursor.resizeLeftCursor,
        NSCursor.resizeRightCursor, NSCursor.resizeLeftRightCursor, NSCursor.resizeUpCursor, NSCursor.resizeDownCursor,
        NSCursor.resizeUpDownCursor, diagonal(true), diagonal(false),
        NSCursor.resizeLeftRightCursor, NSCursor.resizeUpDownCursor, NSCursor.operationNotAllowedCursor, NSCursor.dragLinkCursor,
        NSCursor.dragCopyCursor, NSCursor.contextualMenuCursor,
        [[NSCursor alloc] initWithImage:[[NSImage alloc] initWithSize:NSMakeSize(1, 1)] hotSpot:NSZeroPoint],
    ];
    return cursors[index];
}

/// AppKit does not if its loop has not run since the sheet or panel was shown.
void giveFocusBack(NSWindow* window)
{
    void (^focus)(void) = ^{
        if (NSApp.isActive && window.isVisible && !NSApp.keyWindow.isVisible)
            [window makeKeyWindow];
    };
    focus();
    whenIdle(focus);
}

/// AppKit only passes the focus on while its own loop runs.
static void orderOut(NSWindow* window)
{
    bool wasKey = window.isKeyWindow;
    [window orderOut:nil];
    if (!wasKey)
        return;
    for (NSWindow* next in NSApp.orderedWindows)
        if (next.isVisible && next.isOnActiveSpace && next.canBecomeKeyWindow)
            return giveFocusBack(next);
}

static void endSheet(NSWindow* sheet)
{
    NSWindow* parent = sheet.sheetParent;
    if (!parent)
        return;
    [parent endSheet:sheet];
    [sheet orderOut:nil];
    giveFocusBack(parent);
}

static void setStyle(NSWindow* window, NSWindowStyleMask bit, bool isOn)
{
    if (!!(window.styleMask & bit) != isOn)
        window.styleMask ^= bit;
}

static NSArray<NSButton*>* buttonsOf(NSWindow* window)
{
    NSButton *close = [window standardWindowButton:NSWindowCloseButton], *minimize = [window standardWindowButton:NSWindowMiniaturizeButton],
             *zoom = [window standardWindowButton:NSWindowZoomButton];
    return close && minimize && zoom ? @[ close, minimize, zoom ] : nil;
}

static void activateFor(NSWindow* window, bool insists)
{
    if (!(window.styleMask & NSWindowStyleMaskNonactivatingPanel))
        [NSApp activateIgnoringOtherApps:insists];
}

static bool isFullscreen(NSWindow* window) { return window.styleMask & NSWindowStyleMaskFullScreen; }

@interface BunDesktopView (Frames)
- (void)tick:(id)sender;
@end

/// The refreshes of a display. What is committed while a `CADisplayLink` runs appears later. It is never released, as the thread of the link may use it after it was stopped.
@interface BunDesktopClock : NSObject
@end

@implementation BunDesktopClock {
    CVDisplayLinkRef link;
    CGDirectDisplayID display;
    CFRunLoopSourceRef ticks;
    /// Refreshes are not worth waking up for until then.
    _Atomic CFTimeInterval restsUntil, lastRefresh;
    NSHashTable<BunDesktopView*>* listeners;
    /// Timers are punctual while something moves.
    id activity;
    unsigned ticksInARow;
}

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"

static CVReturn displayIsReady(CVDisplayLinkRef link, const CVTimeStamp* now, const CVTimeStamp* shownAt, CVOptionFlags flags,
    CVOptionFlags* out, void* context)
{
    __unsafe_unretained BunDesktopClock* clock = (__bridge BunDesktopClock*)context;
    clock->lastRefresh = CACurrentMediaTime();
    if (CACurrentMediaTime() < clock->restsUntil)
        return kCVReturnSuccess;
    clock->restsUntil = CACurrentMediaTime() + 0.011;
    CFRunLoopSourceSignal(clock->ticks);
    CFRunLoopWakeUp(CFRunLoopGetMain());
    return kCVReturnSuccess;
}

static void tickAll(void* context)
{
    @autoreleasepool {
        BunDesktopClock* clock = (__bridge BunDesktopClock*)context;
        if (++clock->ticksInARow == 8 && CVDisplayLinkIsRunning(clock->link))
            clock->activity = [NSProcessInfo.processInfo beginActivityWithOptions:NSActivityLatencyCritical reason:@"Animation"];
        for (BunDesktopView* view in clock->listeners.allObjects)
            [view tick:nil];
    }
}

+ (instancetype)ofScreen:(NSScreen*)screen
{
    static NSMutableDictionary<NSNumber*, BunDesktopClock*>* clocks;
    NSNumber* display = screen.deviceDescription[@"NSScreenNumber"];
    if (clocks[display])
        return clocks[display];
    BunDesktopClock* clock = [BunDesktopClock new];
    if (CVDisplayLinkCreateWithCGDisplay(display.unsignedIntValue, &clock->link))
        return nil;
    clock->display = display.unsignedIntValue;
    clock->listeners = NSHashTable.weakObjectsHashTable;
    CFRunLoopSourceContext context = { .info = (__bridge void*)clock, .perform = tickAll };
    clock->ticks = CFRunLoopSourceCreate(NULL, 1, &context);
    CFRunLoopAddSource(CFRunLoopGetMain(), clock->ticks, kCFRunLoopCommonModes);
    CVDisplayLinkSetOutputCallback(clock->link, displayIsReady, (__bridge void*)clock);
    clocks = clocks ?: [NSMutableDictionary new];
    return clocks[display] = clock;
}

- (void)hurry { restsUntil = 0; }

/// A display that has slept or was set up again may no longer call.
- (bool)hasStalled { return CACurrentMediaTime() - lastRefresh > 0.25 && CVDisplayLinkIsRunning(link); }

- (bool)add:(BunDesktopView*)view
{
    [listeners addObject:view];
    if (self.hasStalled) {
        bd_trace("the display has stopped calling", CACurrentMediaTime() - lastRefresh);
        CVDisplayLinkStop(link);
        CVDisplayLinkSetCurrentCGDisplay(link, display);
    }
    if (CVDisplayLinkIsRunning(link))
        return true;
    lastRefresh = CACurrentMediaTime();
    return !CVDisplayLinkStart(link);
}

- (void)remove:(BunDesktopView*)view
{
    [listeners removeObject:view];
    if (listeners.anyObject)
        return;
    if (CVDisplayLinkIsRunning(link))
        CVDisplayLinkStop(link);
    if (activity)
        [NSProcessInfo.processInfo endActivity:activity];
    activity = nil;
    ticksInARow = 0;
}

#pragma clang diagnostic pop

@end

@implementation BunDesktopView {
    /// The window owns its content view, and this its window until that is closed.
    NSWindow* owned;
    NSVisualEffectView* effect;
    NSView* imitation;
    BDBackground background;
    BDMaybeu32 backgroundColor;
    /// What the window had when a background was asked for. An addon may have changed it since, to put a color behind glass.
    NSColor* claimedColor;
    BDMaybePoint trafficLights, sheetOffset;
    bool ownsTitleBar, opensFullscreen, isClosing, isFullscreenable, isVisibleOnFullscreen;
    bool isChangingSpace, hadHiddenButtons;
    void (^afterChangingSpace)(void);
    NSRect frameBeforeSimpleFullscreen;
    NSWindowStyleMask styleBeforeSimpleFullscreen;

    BunDesktopClock* clock;
    /// In place of the clock while something scrolls.
    CADisplayLink* pacer;
    dispatch_source_t alarm;
    CFTimeInterval refresh, paintsFrom, paintsBy, paintingTook;
    bool isAlarmSet, isPaintDue;
    unsigned timesInTheWay;
    id urgency;
    bool wantsFrame, isAwake, isScrolling, wasSeen, wasVisible;
    CFTimeInterval lastScroll;
    int idleTicks;
    CFTimeInterval lastFrame, lastPace;

    NSCursor* cursor;
    NSEvent* lastPress;
    float aspectRatio;
    BDSize beyondAspectRatio;
    NSInteger attention;
    NSURL* previewed;
    NSString* previewTitle;
    bool hasMouse, isPressed;
    /// What the page has begun.
    bool isDragging, isDragInside, wasDropped;
    NSDragOperation allowedElsewhere;

    NSEvent *sentEquivalent, *lastKey;
    bool hasCommitted;
    bool isInKeyDown, keyIsPending, wasComposing, isComposing, ignoresInputMethod, hadTextInput;

}

+ (BunDesktopView*)withNumber:(uint32_t)number { return views[@(number)]; }

- (instancetype)initWithOptions:(const BDWindowOptions*)options
{
    traceLaunch("a window is wanted");
    NSRect content = NSMakeRect(0, 0, options->width, options->height);
    self = [super initWithFrame:content];
    _number = options->id;
    _isFocusable = true;
    cursor = NSCursor.arrowCursor;
    bool hasFrame = options->frame, floats = options->kind == BDWindowKindPopup || options->kind == BDWindowKindFloating;
    ownsTitleBar = !hasFrame || options->hiddenTitleBar;
    opensFullscreen = options->fullscreen;
    trafficLights = options->trafficLightPosition;
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable
        | (options->minimizable ? NSWindowStyleMaskMiniaturizable : 0) | (options->resizable ? NSWindowStyleMaskResizable : 0)
        | (ownsTitleBar ? NSWindowStyleMaskFullSizeContentView : 0) | (floats ? NSWindowStyleMaskNonactivatingPanel : 0);
    Class class = floats ? BunDesktopPanel.class : BunDesktopWindow.class;
    NSWindow* window = owned = [[class alloc] initWithContentRect:content styleMask:style backing:NSBackingStoreBuffered defer:NO];
    window.releasedWhenClosed = NO;
    window.restorable = NO;
    window.hidesOnDeactivate = NO;
    if (stringIfAny(options->tabbingIdentifier)) {
        NSWindow.allowsAutomaticWindowTabbing = YES;
        window.tabbingIdentifier = string(options->tabbingIdentifier);
    } else
        window.tabbingMode = NSWindowTabbingModeDisallowed;
    window.animationBehavior = NSWindowAnimationBehaviorNone;
    window.title = string(options->title);
    window.movable = options->movable;
    window.minSize = NSMakeSize(options->minWidth, options->minHeight);
    [window setFrame:content display:NO];
    if (ownsTitleBar) {
        window.titlebarAppearsTransparent = YES;
        window.titleVisibility = NSWindowTitleHidden;
    }
    for (NSButton* button in buttonsOf(window))
        button.hidden = !hasFrame;
    if (floats) {
        window.level = options->kind == BDWindowKindPopup ? NSPopUpMenuWindowLevel : NSFloatingWindowLevel;
        window.animationBehavior = NSWindowAnimationBehaviorUtilityWindow;
        window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
    }
    [window setFrameTopLeftPoint:NSMakePoint(options->x.has ? options->x.value : 0, primaryHeight() - (options->y.has ? options->y.value : 0))];

    self.frame = window.contentView.bounds;
    self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    self.layer = [CALayer new];
    self.layer.actions = @{ @"bounds" : NSNull.null, @"position" : NSNull.null, @"sublayers" : NSNull.null };
    self.wantsLayer = YES;
    window.contentView.wantsLayer = YES;
    [window.contentView addSubview:self];
    [window makeFirstResponder:self];
    NSTrackingAreaOptions tracking = NSTrackingMouseEnteredAndExited | NSTrackingMouseMoved | NSTrackingActiveAlways | NSTrackingInVisibleRect;
    [self addTrackingArea:[[NSTrackingArea alloc] initWithRect:NSZeroRect options:tracking owner:self userInfo:nil]];
    [self registerForDraggedTypes:@[ NSPasteboardTypeFileURL, draggedByPage ]];
    background = options->background;
    backgroundColor = options->backgroundColor;
    [self paintBackground];
    if (options->maximized)
        [window zoom:nil];
    _frequency = window.screen.maximumFramesPerSecond;
    [self placeTrafficLights];
    window.delegate = self;
    views = views ?: [NSMutableDictionary new];
    views[@(_number)] = self;
    traceLaunch("there is a window");
    return self;
}

- (void)close
{
    isClosing = true;
    [self stopLinkForGood];
    views[@(_number)] = nil;
    NSWindow* window = owned;
    owned = nil;
    endSheet(window);
    if (window.attachedSheet)
        [window endSheet:window.attachedSheet];
    // AppKit may be in the middle of telling it something.
    if (!isFullscreen(window) && !isChangingSpace)
        orderOut(window);
    // One that cannot have the focus does not pass it on.
    _isFocusable = _isFocusable && window.isVisible;
    if (styleBeforeSimpleFullscreen)
        NSApp.presentationOptions = 0;
    whenIdle(^{
        [self unlessChangingSpace:^{
            [window close];
            window.delegate = nil;
            [self removeFromSuperview];
        }];
    });
}

- (void)report:(BDReport)event
{
    if (!isClosing)
        bd_window_event(_number, event);
}

#define event(...) ((BDWindowEvent) { __VA_ARGS__ })
- (void)send:(BDWindowEvent)event
{
    if (!isClosing)
        bd_emit_to_window(_number, &event);
}

- (bool)isMaximized
{
    NSRect frame = owned.frame, visible = owned.screen.visibleFrame;
    return !isFullscreen(owned) && fabs(frame.size.width - visible.size.width) < 1 && fabs(frame.size.height - visible.size.height) < 1;
}

- (BDGeometry)geometry
{
    NSRect frame = owned.frame;
    NSSize size = self.bounds.size;
    return (BDGeometry) { frame.origin.x, primaryHeight() - NSMaxY(frame), frame.size.height - size.height, 0, size.width, size.height,
        owned.backingScaleFactor, self.isMaximized, isFullscreen(owned), false };
}

/// What is seen where nothing has been drawn.
static NSArray* channels(NSColor* any)
{
    NSColor* color = [any colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
    return color.alphaComponent > 0 ? @[ @(color.redComponent), @(color.greenComponent), @(color.blueComponent), @(color.alphaComponent) ] : nil;
}

/// Adds the frames of what blurs, and those of what has a color with that color.
static void describe(NSView* view, NSView* root, NSMutableArray* parts)
{
    NSRect frame = [view convertRect:view.bounds toView:root];
    NSArray* rect = @[ @(frame.origin.x), @(frame.origin.y), @(frame.size.width), @(frame.size.height) ];
    if (view.isHidden)
        return;
    if ([view isKindOfClass:NSVisualEffectView.class] || [view.className containsString:@"Glass"])
        [parts addObject:rect];
    NSArray* color = view.layer.backgroundColor ? channels([NSColor colorWithCGColor:view.layer.backgroundColor]) : nil;
    if (color)
        [parts addObject:[rect arrayByAddingObjectsFromArray:color]];
    for (NSView* child in view.subviews)
        describe(child, root, parts);
}

- (NSArray*)describeBackdrop
{
    NSMutableArray* parts = [NSMutableArray new];
    for (NSView* view in owned.contentView.subviews) {
        if (view == self)
            break;
        if (view != effect && view != imitation)
            describe(view, owned.contentView, parts);
    }
    __block NSArray* color;
    [owned.effectiveAppearance performAsCurrentDrawingAppearance:^{
        color = channels(self->owned.backgroundColor);
    }];
    if (!parts.count || !color)
        return parts;
    // There is nothing to blur.
    [parts filterUsingPredicate:[NSPredicate predicateWithFormat:@"SELF.@count > 4"]];
    [parts insertObject:[@[ @0, @0, @(self.bounds.size.width), @(self.bounds.size.height) ] arrayByAddingObjectsFromArray:color] atIndex:0];
    return parts;
}

/// What it stands for does not have quite its color.
- (void)fadeImitation
{
    NSView* old = imitation;
    imitation = nil;
    if (!old)
        return;
    for (NSView* part in old.subviews)
        if ([part isKindOfClass:NSVisualEffectView.class])
            return [old removeFromSuperview];
    CABasicAnimation* fading = [CABasicAnimation animationWithKeyPath:@"opacity"];
    fading.fromValue = @1;
    fading.toValue = @0;
    fading.duration = 0.12;
    fading.fillMode = kCAFillModeForwards;
    fading.removedOnCompletion = NO;
    [old.layer addAnimation:fading forKey:nil];
    [old performSelector:@selector(removeFromSuperview) withObject:nil afterDelay:0.2 inModes:@[ NSRunLoopCommonModes ]];
}

- (void)imitateBackdrop:(const BDBackdropPart*)parts count:(size_t)count
{
    [self fadeImitation];
    if (!count)
        return;
    imitation = [[NSView alloc] initWithFrame:self.frame];
    imitation.wantsLayer = YES;
    bool blurs = false;
    for (const BDBackdropPart* part = parts; part < parts + count; part++) {
        const double *edges = part->frame.at, *color = part->color.value.at;
        NSRect frame = NSMakeRect(edges[0], edges[1], edges[2], edges[3]);
        if (part->color.has) {
            NSView* view = [[NSView alloc] initWithFrame:frame];
            view.wantsLayer = YES;
            view.layer.backgroundColor = [NSColor colorWithSRGBRed:color[0] green:color[1] blue:color[2] alpha:color[3]].CGColor;
            [imitation addSubview:view];
        } else if (!blurs) {
            blurs = true;
            NSVisualEffectView* view = [[NSVisualEffectView alloc] initWithFrame:frame];
            view.material = NSVisualEffectMaterialSidebar;
            view.state = NSVisualEffectStateActive;
            [imitation addSubview:view];
        }
    }
    [owned.contentView addSubview:imitation positioned:NSWindowBelow relativeTo:self];
}

/// These properties are private. Returns whether it has stopped looking to its right, or left.
static bool confine(CALayer* layer, bool isLeft, bool isEverywhere)
{
    for (NSString* name in @[ @"marginWidth", @"setMarginWidth:", @"backdropRect", @"setBackdropRect:", @"updateRate", @"setUpdateRate:" ])
        if (![layer respondsToSelector:NSSelectorFromString(name)])
            return false;
    void (^set)(NSString*, id) = ^(NSString* key, id value) {
        bd_trace(key.UTF8String, 0);
        [CATransaction begin];
        CATransaction.disableActions = YES;
        [layer setValue:value forKey:key];
        [CATransaction commit];
    };
    // Below zero, so that it shows when AppKit takes the margin away.
    double margin = [[layer valueForKey:@"marginWidth"] doubleValue];
    if (margin > 0 && !isEverywhere) {
        set(@"marginOfAppKit", @(margin));
        set(@"marginWidth", @-0.001);
    } else if (!margin && [[layer valueForKey:@"marginOfAppKit"] doubleValue]) {
        set(@"marginOfAppKit", @0);
        set(@"backdropRect", [NSValue valueWithRect:CGRectNull]);
    }
    margin = isEverywhere ? 0 : [[layer valueForKey:@"marginOfAppKit"] doubleValue];
    double rate = margin ? 0 : 30;
    if ([[layer valueForKey:@"updateRate"] doubleValue] != rate)
        set(@"updateRate", @(rate));
    if (!margin)
        return true;
    NSRect wanted = NSOffsetRect(NSInsetRect(layer.bounds, -margin / 2, -margin), isLeft ? -margin / 2 : margin / 2, 0);
    NSRect current = [[layer valueForKey:@"backdropRect"] rectValue];
    if (!NSContainsRect(NSInsetRect(wanted, -0.1, -0.1), current) || !NSContainsRect(NSInsetRect(current, -0.1, -0.1), wanted))
        set(@"backdropRect", [NSValue valueWithRect:wanted]);
    return true;
}

static void findReach(CALayer* layer, CALayer* root, double* edges)
{
    static const double margin = 101;
    if (layer.isHidden)
        return;
    // A private class.
    if (strcmp(object_getClassName(layer), "CABackdropLayer")) {
        for (CALayer* it in layer.sublayers)
            findReach(it, root, edges);
        return;
    }
    static int mayConfine = -1;
    mayConfine = mayConfine < 0 ? !!strcmp(getenv("BUN_DESKTOP_CONFINE_BACKDROP") ?: "", "0") : mayConfine;
    NSRect frame = [layer convertRect:layer.bounds toLayer:root], all = root.bounds;
    if (frame.size.height < all.size.height / 2 || frame.size.width < 1)
        return;
    bool isEverywhere = frame.size.width > all.size.width * 0.8;
    double reach = mayConfine && confine(layer, NSMidX(frame) < NSMidX(all), isEverywhere) ? 0 : margin;
    if (isEverywhere)
        return;
    edges[0] = edges[1] ? fmin(edges[0], NSMinX(frame) - reach) : NSMinX(frame) - reach;
    edges[1] = fmax(edges[1], NSMaxX(frame) + reach);
}

/// The window server blurs again when a layer changes that overlaps what the blur looks at, and then misses frames.
- (void)fitBackdrop:(double*)edges
{
    NSRect frame = NSMakeRect(edges[0], 0, edges[1] - edges[0], self.bounds.size.height);
    if (effect && !NSEqualRects(effect.frame, frame)) {
        bd_trace("the width of the backdrop", frame.size.width / 1000);
        effect.frame = frame;
    }
    [self findBackdrop:edges];
}

- (void)findBackdrop:(double*)edges
{
    edges[0] = edges[1] = 0;
    for (NSView* view in owned.contentView.subviews) {
        if (view == self)
            break;
        findReach(view.layer, owned.contentView.layer, edges);
    }
}

- (void)claimBackground { claimedColor = owned.backgroundColor; }

- (void)paintBackground
{
    uint32_t color = backgroundColor.value;
    // The shadow of a clear window is computed again for every frame.
    bool isFilled = background.tag == BDBackgroundTransparent && backgroundColor.has && (color & 255) == 255;
    bool isOpaque = background.tag == BDBackgroundOpaque || isFilled;
    if (!claimedColor || [claimedColor isEqual:owned.backgroundColor]) {
        owned.opaque = isOpaque;
        // The blur hides it.
        if (background.tag == BDBackgroundBlurred)
            owned.backgroundColor = NSColor.windowBackgroundColor;
        else if (!isOpaque)
            owned.backgroundColor = NSColor.clearColor;
        else if (backgroundColor.has)
            owned.backgroundColor = [NSColor colorWithSRGBRed:(color >> 24) / 255. green:(color >> 16 & 255) / 255. blue:(color >> 8 & 255) / 255. alpha:(color & 255) / 255.];
        else
            owned.backgroundColor = NSColor.windowBackgroundColor;
        [self claimBackground];
    } else
        bd_trace("the color of the window is left alone", 0);
    if (background.tag != BDBackgroundBlurred) {
        [effect removeFromSuperview];
        effect = nil;
        return;
    }
    if (!effect) {
        effect = [[NSVisualEffectView alloc] initWithFrame:owned.contentView.bounds];
        effect.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        effect.blendingMode = NSVisualEffectBlendingModeBehindWindow;
        [owned.contentView addSubview:effect positioned:NSWindowBelow relativeTo:nil];
    }
    static const NSVisualEffectMaterial materials[] = {
        [BDMaterialUnderWindow] = NSVisualEffectMaterialUnderWindowBackground, [BDMaterialTitlebar] = NSVisualEffectMaterialTitlebar,
        [BDMaterialSelection] = NSVisualEffectMaterialSelection, [BDMaterialMenu] = NSVisualEffectMaterialMenu,
        [BDMaterialPopover] = NSVisualEffectMaterialPopover, [BDMaterialSidebar] = NSVisualEffectMaterialSidebar,
        [BDMaterialHeader] = NSVisualEffectMaterialHeaderView, [BDMaterialSheet] = NSVisualEffectMaterialSheet,
        [BDMaterialWindow] = NSVisualEffectMaterialWindowBackground, [BDMaterialHud] = NSVisualEffectMaterialHUDWindow,
        [BDMaterialFullscreenUi] = NSVisualEffectMaterialFullScreenUI, [BDMaterialTooltip] = NSVisualEffectMaterialToolTip,
        [BDMaterialContent] = NSVisualEffectMaterialContentBackground, [BDMaterialUnderPage] = NSVisualEffectMaterialUnderPageBackground,
    };
    static const NSVisualEffectState states[] = {
        [BDEffectStateFollowsWindow] = NSVisualEffectStateFollowsWindowActiveState, [BDEffectStateActive] = NSVisualEffectStateActive,
        [BDEffectStateInactive] = NSVisualEffectStateInactive,
    };
    effect.material = materials[background.blurred.material];
    effect.state = states[background.blurred.state];
}

/// AppKit puts them back whenever it lays out the title bar.
- (void)placeTrafficLights
{
    NSArray<NSButton*>* buttons = buttonsOf(owned);
    if (!trafficLights.has || !buttons || isFullscreen(owned))
        return;
    CGFloat x = trafficLights.value.x, y = trafficLights.value.y;
    CGFloat step = NSMinX(buttons[1].frame) - NSMinX(buttons[0].frame), height = buttons[0].frame.size.height + 2 * y;
    NSView* bar = buttons[0].superview.superview;
    bar.frame = NSMakeRect(0, bar.superview.bounds.size.height - height, bar.frame.size.width, height);
    for (NSButton* button in buttons) {
        button.frameOrigin = NSMakePoint(x, y);
        x += step;
    }
    [buttons[0].superview updateTrackingAreas];
}

// ───────────────────────────── frames ─────────────────────────────

/// AppKit takes its time to say that a window is seen, and one without opacity is about to be.
- (bool)needsFrames
{
    return owned.isVisible && (owned.occlusionState & NSWindowOcclusionStateVisible || !wasSeen || owned.alphaValue == 0);
}

- (void)startLink
{
    NSScreen* screen = owned.screen ?: NSScreen.screens.firstObject;
    idleTicks = 0;
    isAwake = screen && self.needsFrames;
    if (!isAwake)
        return [self stopLink];
    clock = clock ?: [BunDesktopClock ofScreen:screen];
    isAwake = [clock add:self];
    if (!isAwake && wantsFrame)
        [self performSelector:@selector(tick:) withObject:nil afterDelay:1 / 60. inModes:@[ NSRunLoopCommonModes ]];
}

- (void)stopLink
{
    isAwake = false;
    [clock remove:self];
    [self stopPacing];
}

static bool isClock(const char* name) { return !strcmp(getenv("BUN_DESKTOP_CLOCK") ?: "", name); }

/// The window server takes what was committed around the time of a refresh, and the clock only calls half a frame before that.
/// Up to macOS 15, scroll events keep arriving between refreshes, and would have to wait.
- (void)setScrolling:(bool)isOn
{
    isScrolling = isOn;
    if (!isOn || pacer || NSProcessInfo.processInfo.operatingSystemVersion.majorVersion <= 15 || isClock("video"))
        return;
    float most = owned.screen.maximumFramesPerSecond ?: 60;
    pacer = [self displayLinkWithTarget:self selector:@selector(pace:)];
    pacer.preferredFrameRateRange = CAFrameRateRangeMake(MIN(60, most), most, most);
    [pacer addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
    urgency = [NSProcessInfo.processInfo beginActivityWithOptions:NSActivityLatencyCritical reason:@"Scrolling"];
    __weak BunDesktopView* weak = self;
    alarm = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, DISPATCH_TIMER_STRICT, dispatch_get_main_queue());
    dispatch_source_set_event_handler(alarm, ^{
        [weak alarmRings];
    });
    dispatch_source_set_timer(alarm, DISPATCH_TIME_FOREVER, DISPATCH_TIME_FOREVER, 0);
    dispatch_resume(alarm);
    lastPace = CACurrentMediaTime();
    isAwake = true;
}

- (void)setAlarm:(CFTimeInterval)time
{
    isAlarmSet = true;
    dispatch_source_set_timer(alarm, dispatch_time(DISPATCH_TIME_NOW, (time - CACurrentMediaTime()) * NSEC_PER_SEC), DISPATCH_TIME_FOREVER, 0);
}

- (void)alarmRings
{
    isAlarmSet = false;
    if (isPaintDue)
        [self paintPaced];
}

- (void)stopPacing
{
    if (!pacer)
        return;
    [pacer invalidate];
    pacer = nil;
    dispatch_source_cancel(alarm);
    alarm = nil;
    isAlarmSet = isPaintDue = false;
    [NSProcessInfo.processInfo endActivity:urgency];
    urgency = nil;
    _frequency = owned.screen.maximumFramesPerSecond;
}

/// Right after a refresh, when the window server takes a frame. It may be late, and must not take the next one yet.
/// It misses the next refresh if it has to share the GPU for too long.
- (void)pace:(CADisplayLink*)link
{
    CFTimeInterval interval = MAX(link.targetTimestamp - link.timestamp, 1 / link.preferredFrameRateRange.maximum);
    refresh = link.timestamp;
    commitsFrom = refresh + interval / 2;
    // The main queue waits for a nested run loop.
    paintsBy = isAlarmSet || isClock("early") ? refresh : refresh + interval - 0.0025 - paintingTook;
    paintsFrom = MIN(refresh + MAX(interval / 2, interval - 0.0075), paintsBy);
    lastPace = CACurrentMediaTime();
    bd_trace("paced", lastPace - link.timestamp);
    _frequency = 1 / interval;
    [clock remove:self];
    isPaintDue = true;
    if (paintsFrom > lastPace)
        [self setAlarm:paintsFrom];
    else
        [self paintPaced];
}

- (void)paintPaced
{
    CFTimeInterval began = CACurrentMediaTime();
    bool isInTheWay = windowServerIsBusy();
    // A display that shows a surface as it is keeps it until the next refresh.
    if (isInTheWay && began < paintsBy && timesInTheWay < 3)
        return [self setAlarm:MIN(began + 0.0004, paintsBy)];
    timesInTheWay = isInTheWay ? timesInTheWay + 1 : 0;
    isPaintDue = false;
    waitedToCommit = 0;
    [self tick:nil];
    CFTimeInterval ended = CACurrentMediaTime();
    paintingTook = MAX(MIN(ended - began - waitedToCommit, 1 / _frequency), paintingTook * 0.9);
    bd_paced(paintsFrom - refresh, began - refresh, ended - refresh, isInTheWay);
    if (isScrolling || !pacer)
        return;
    [self stopLink];
    if (wantsFrame)
        [self startLink];
}

- (bool)isTooLate { return pacer && (isPaintDue || CACurrentMediaTime() + paintingTook > refresh + 1 / _frequency); }

- (void)stopLinkForGood
{
    [self stopLink];
    clock = nil;
}

- (void)tick:(id)sender
{
    if (!wantsFrame) {
        if (++idleTicks > 4)
            [self stopLink];
        return;
    }
    wantsFrame = false;
    idleTicks = 0;
    lastFrame = CACurrentMediaTime();
    [self report:BDFrameIsDue];
}

- (void)requestFrame:(bool)isLeisurely
{
    wantsFrame = true;
    if (!isLeisurely)
        [clock hurry];
    if (pacer && CACurrentMediaTime() - lastPace > 0.25)
        [self stopLink];
    if (isAwake && clock.hasStalled)
        [self startLink];
    if (isAwake)
        return;
    isAwake = true;
    soon(^{
        if (self->isClosing)
            return;
        if (CACurrentMediaTime() - self->lastFrame < 0.03 || !self.needsFrames)
            return [self startLink];
        // The next frame follows, and the link takes its time to start.
        if (CACurrentMediaTime() - self->lastScroll < 0.03)
            [self startLink];
        else
            self->isAwake = false;
        [self tick:nil];
    });
}

// ───────────────────────────── the window ─────────────────────────────

- (void)visibilityMayHaveChanged
{
    bool isVisible = self.needsFrames;
    if (isVisible)
        [self placeTrafficLights];
    [self startLink];
    if (isVisible != wasVisible) {
        wasVisible = isVisible;
        [self report:BDVisibilityChanged];
    }
}

- (void)windowDidChangeOcclusionState:(NSNotification*)notification
{
    wasSeen = owned.isVisible;
    [self visibilityMayHaveChanged];
}

- (void)windowDidResize:(NSNotification*)notification
{
    [self placeTrafficLights];
    [self report:BDResized];
}

- (void)windowDidMove:(NSNotification*)notification { [self report:BDMoved]; }
- (void)windowDidChangeBackingProperties:(NSNotification*)notification { [self report:BDResized]; }

- (void)windowDidChangeScreen:(NSNotification*)notification
{
    _frequency = owned.screen.maximumFramesPerSecond;
    [self stopLinkForGood];
    [self startLink];
    [self report:BDMoved];
}

- (void)windowDidBecomeKey:(NSNotification*)notification
{
    [self placeTrafficLights];
    updateSecureInput();
    [self report:BDActivated];
}

- (void)windowDidResignKey:(NSNotification*)notification
{
    [self placeTrafficLights];
    updateSecureInput();
    [self report:BDDeactivated];
    // Glass changes a little later.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC / 10), dispatch_get_main_queue(), ^{
        double edges[2];
        [self findBackdrop:edges];
    });
}

- (NSSize)windowWillResize:(NSWindow*)window toSize:(NSSize)size
{
    if (aspectRatio <= 0)
        return size;
    CGFloat width = beyondAspectRatio.width, height = beyondAspectRatio.height + window.frame.size.height - self.bounds.size.height;
    return NSMakeSize(round((size.height - height) * aspectRatio + width), size.height);
}

- (void)newWindowForTab:(id)sender { [self send:event(BDWindowEventNewTab)]; }

- (BOOL)acceptsPreviewPanelControl:(QLPreviewPanel*)panel { return previewed != nil; }
- (void)beginPreviewPanelControl:(QLPreviewPanel*)panel { panel.dataSource = (id)self; }
- (void)endPreviewPanelControl:(QLPreviewPanel*)panel { panel.dataSource = nil; }
- (NSInteger)numberOfPreviewItemsInPreviewPanel:(QLPreviewPanel*)panel { return 1; }
- (id)previewPanel:(QLPreviewPanel*)panel previewItemAtIndex:(NSInteger)index { return self; }
- (NSURL*)previewItemURL { return previewed; }
- (NSString*)previewItemTitle { return previewTitle; }

- (void)windowDidBecomeMain:(NSNotification*)notification { [self placeTrafficLights]; }
- (void)windowDidResignMain:(NSNotification*)notification { [self placeTrafficLights]; }
- (NSRect)window:(NSWindow*)window willPositionSheet:(NSWindow*)sheet usingRect:(NSRect)rect
{
    if (sheetOffset.has)
        rect.origin = NSMakePoint(sheetOffset.value.x, window.contentView.frame.size.height - sheetOffset.value.y);
    return rect;
}

- (void)windowDidEndSheet:(NSNotification*)notification { [self placeTrafficLights]; }

- (BOOL)windowShouldClose:(NSWindow*)sender
{
    [self report:BDCloseRequested];
    return NO;
}

- (void)windowWillClose:(NSNotification*)notification { [self report:BDWasClosed]; }

/// They would jump.
- (void)setTrafficLightsHidden:(bool)isHidden
{
    if (trafficLights.has)
        buttonsOf(owned).firstObject.superview.superview.hidden = isHidden;
    [self placeTrafficLights];
}

/// AppKit ignores what it is asked for in the meantime, which lasts longer than it says.
- (void)didChangeSpace
{
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC / 4), dispatch_get_main_queue(), ^{
        void (^next)(void) = self->afterChangingSpace;
        self->isChangingSpace = false;
        self->afterChangingSpace = nil;
        if (next)
            whenIdle(next);
    });
}

- (void)unlessChangingSpace:(void (^)(void))body
{
    if (isChangingSpace)
        afterChangingSpace = body;
    else
        body();
}

- (void)windowWillEnterFullScreen:(NSNotification*)notification { isChangingSpace = true; }
- (void)windowDidFailToEnterFullScreen:(NSWindow*)window { [self didChangeSpace]; }

- (void)windowWillExitFullScreen:(NSNotification*)notification
{
    isChangingSpace = true;
    [self setTrafficLightsHidden:true];
}

- (void)windowDidFailToExitFullScreen:(NSWindow*)window
{
    [self didChangeSpace];
    [self setTrafficLightsHidden:false];
}

- (void)windowDidEnterFullScreen:(NSNotification*)notification
{
    [self didChangeSpace];
    [self report:BDMoved];
    [self send:event(BDWindowEventFullscreen, .fullscreen = true)];
}

- (void)windowDidExitFullScreen:(NSNotification*)notification
{
    [self didChangeSpace];
    [self setTrafficLightsHidden:false];
    [self report:BDMoved];
    [self send:event(BDWindowEventFullscreen, .fullscreen = false)];
}


- (void)windowDidMiniaturize:(NSNotification*)notification
{
    [self send:event(BDWindowEventMinimized, .minimized = true)];
    [self visibilityMayHaveChanged];
}

- (void)windowDidDeminiaturize:(NSNotification*)notification
{
    [self send:event(BDWindowEventMinimized, .minimized = false)];
    [self visibilityMayHaveChanged];
}

- (void)windowWillStartLiveResize:(NSNotification*)notification { [self send:event(BDWindowEventResizing, .resizing = true)]; }
- (void)windowDidEndLiveResize:(NSNotification*)notification { [self send:event(BDWindowEventResizing, .resizing = false)]; }
- (void)windowWillMove:(NSNotification*)notification { [self send:event(BDWindowEventMoving)]; }

- (void)viewDidChangeEffectiveAppearance
{
    [super viewDidChangeEffectiveAppearance];
    [self placeTrafficLights];
    if (owned.delegate)
        [self report:BDAppearanceChanged];
}

- (void)setVisible:(bool)isVisible focus:(bool)takesFocus
{
    if (!isVisible) {
        wasSeen = false;
        if (owned.attachedSheet)
            [owned endSheet:owned.attachedSheet];
        orderOut(owned);
    } else if (takesFocus) {
        activateFor(owned, true);
        [owned makeKeyAndOrderFront:nil];
        traceLaunch("the window is shown");
    } else
        [owned orderFrontRegardless];
    if (isVisible && opensFullscreen) {
        opensFullscreen = false;
        [owned toggleFullScreen:nil];
    }
    [self visibilityMayHaveChanged];
}

- (void)setSimpleFullscreen:(bool)isOn
{
    if (isOn == !!styleBeforeSimpleFullscreen)
        return;
    NSWindowStyleMask style = isOn ? NSWindowStyleMaskBorderless : styleBeforeSimpleFullscreen;
    styleBeforeSimpleFullscreen = isOn ? owned.styleMask : 0;
    if (isOn)
        frameBeforeSimpleFullscreen = owned.frame;
    NSApp.presentationOptions = isOn ? NSApplicationPresentationAutoHideDock | NSApplicationPresentationAutoHideMenuBar : 0;
    NSArray* wereHidden = [buttonsOf(owned) valueForKey:@"hidden"];
    hadHiddenButtons = wereHidden ? [wereHidden.firstObject boolValue] : hadHiddenButtons;
    owned.styleMask = style;
    [buttonsOf(owned) setValue:@(hadHiddenButtons) forKey:@"hidden"];
    [owned setFrame:isOn ? owned.screen.frame : frameBeforeSimpleFullscreen display:YES];
    [owned makeFirstResponder:self];
}

- (void)setStyle:(const BDWindowStyle*)style
{
    NSWindow* window = owned;
    __block NSWindowCollectionBehavior behavior = window.collectionBehavior;
    void (^behave)(NSWindowCollectionBehavior, bool) = ^(NSWindowCollectionBehavior bit, bool isOn) {
        behavior = isOn ? behavior | bit : behavior & ~bit;
    };
#define with(name) for (bool isOn = style->name.value, once = style->name.has; once; once = false)
    with(shadow) window.hasShadow = isOn;
    with(movable) window.movable = isOn;
    with(focusable) self.isFocusable = isOn;
    with(closable) setStyle(window, NSWindowStyleMaskClosable, isOn);
    with(minimizable) setStyle(window, NSWindowStyleMaskMiniaturizable, isOn);
    with(buttons) [buttonsOf(window) setValue:@(!isOn) forKey:@"hidden"];
    with(roundedCorners) if (!isOn) {
        setStyle(window, NSWindowStyleMaskTitled, false);
        [window makeFirstResponder:self];
    }
    with(fullScreenable) isFullscreenable = isOn;
    with(visibleOnFullScreen) isVisibleOnFullscreen = isOn;
    if (style->fullScreenable.has || style->visibleOnFullScreen.has) {
        behave(NSWindowCollectionBehaviorFullScreenPrimary, isFullscreenable && !isVisibleOnFullscreen);
        behave(NSWindowCollectionBehaviorFullScreenAuxiliary, !isFullscreenable || isVisibleOnFullscreen);
    }
    with(hiddenInMissionControl) {
        behave(NSWindowCollectionBehaviorManaged | NSWindowCollectionBehaviorStationary, false);
        behave(NSWindowCollectionBehaviorTransient, isOn);
    }
    window.collectionBehavior = behavior;
    with(isInWindowMenu) window.excludedFromWindowsMenu = !isOn;
    with(zoomable) [window standardWindowButton:NSWindowZoomButton].enabled = isOn;
    if (style->level.has)
        window.level = style->level.value;
}

- (void)setFullscreen:(bool)isOn
{
    NSWindow* window = owned;
    opensFullscreen = isOn && !window.isVisible;
    if (!opensFullscreen)
        [self unlessChangingSpace:^{
            if (isFullscreen(window) != isOn)
                [window toggleFullScreen:nil];
        }];
}

- (void)lookUp:(NSString*)words
{
    NSPoint mouse = owned.mouseLocationOutsideOfEventStream;
    whenIdle(^{
        [self showDefinitionForAttributedString:[[NSAttributedString alloc] initWithString:words] atPoint:mouse];
    });
}

- (void)execute:(const BDWindowCommand*)command
{
    NSWindow* window = owned;
    switch (command->tag) {
    case BDWindowCommandDestroy:
    case BDWindowCommandShow:
    case BDWindowCommandHide:
    case BDWindowCommandEnabled:
    case BDWindowCommandAutoHideCursor:
    case BDWindowCommandIcon:
    case BDWindowCommandShape:
    case BDWindowCommandSkipTaskbar: break;
    case BDWindowCommandSheetOffset: sheetOffset = (BDMaybePoint) { true, command->sheetOffset }; break;
    case BDWindowCommandDragFiles: [self dragFiles:strings(command->dragFiles.paths) icon:imageOf(command->dragFiles.icon)]; break;
    case BDWindowCommandTitle: window.title = string(command->title); break;
    case BDWindowCommandBackground:
        background = command->background;
        [self paintBackground];
        break;
    case BDWindowCommandBackgroundColor:
        backgroundColor = command->backgroundColor;
        [self paintBackground];
        break;
    case BDWindowCommandSize: {
        NSRect frame = window.frame;
        [window setFrame:NSMakeRect(frame.origin.x, NSMaxY(frame) - command->size.height, command->size.width, command->size.height) display:YES];
        break;
    }
    case BDWindowCommandPosition: window.frameTopLeftPoint = NSMakePoint(command->position.x, primaryHeight() - command->position.y); break;
    case BDWindowCommandBounds: {
        BDRect bounds = command->bounds.bounds;
        NSRect frame = NSMakeRect(bounds.x, primaryHeight() - bounds.y - bounds.height, bounds.width, bounds.height);
        [window setFrame:frame display:YES animate:command->bounds.animates];
        break;
    }
    case BDWindowCommandLimits: {
        BDSize min = command->limits.min, max = command->limits.max.has ? command->limits.max.value : (BDSize) { FLT_MAX, FLT_MAX };
        window.minSize = NSMakeSize(min.width, min.height);
        window.maxSize = NSMakeSize(max.width, max.height);
        setStyle(window, NSWindowStyleMaskResizable, command->limits.isResizable);
        break;
    }
    case BDWindowCommandStyle: [self setStyle:&command->style]; break;
    case BDWindowCommandMoveTop: [window orderFrontRegardless]; break;
    case BDWindowCommandFocus:
        activateFor(window, false);
        [window makeKeyAndOrderFront:nil];
        break;
    case BDWindowCommandShowAsSheet: {
        NSWindow* parent = views[@(command->showAsSheet)].window;
        activateFor(parent, true);
        [parent beginSheet:window completionHandler:nil];
        [self visibilityMayHaveChanged];
        break;
    }
    case BDWindowCommandParent:
        endSheet(window);
        [window.parentWindow removeChildWindow:window];
        if (window.isVisible && command->parent.has)
            [views[@(command->parent.value)].window addChildWindow:window ordered:NSWindowAbove];
        break;
    case BDWindowCommandMinimize: {
        [self unlessChangingSpace:^{
            [window miniaturize:nil];
        }];
        break;
    }
    case BDWindowCommandRestore: [window deminiaturize:nil]; break;
    case BDWindowCommandMaximize:
        if (self.isMaximized != command->maximize)
            [window zoom:nil];
        break;
    case BDWindowCommandFullscreen: [self setFullscreen:command->fullscreen]; break;
    case BDWindowCommandSimpleFullscreen: [self setSimpleFullscreen:command->simpleFullscreen]; break;
    case BDWindowCommandAlwaysOnTop: window.level = command->alwaysOnTop ? NSFloatingWindowLevel : NSNormalWindowLevel; break;
    case BDWindowCommandAllWorkspaces:
        window.collectionBehavior = (window.collectionBehavior & ~NSWindowCollectionBehaviorCanJoinAllSpaces)
            | (command->allWorkspaces ? NSWindowCollectionBehaviorCanJoinAllSpaces : 0);
        break;
    case BDWindowCommandContentProtection: window.sharingType = command->contentProtection ? NSWindowSharingNone : NSWindowSharingReadOnly; break;
    case BDWindowCommandOpacity: window.alphaValue = fmax(0, fmin(command->opacity, 1)); break;
    case BDWindowCommandIgnoreMouseEvents: window.ignoresMouseEvents = command->ignoreMouseEvents; break;
    case BDWindowCommandAttention:
        [NSApp cancelUserAttentionRequest:attention];
        attention = command->attention && !window.isKeyWindow ? [NSApp requestUserAttention:NSCriticalRequest] : 0;
        break;
    case BDWindowCommandBlur:
        if (window.isVisible) {
            [window orderOut:nil];
            [window orderBack:nil];
        }
        break;
    case BDWindowCommandMoveAbove: [window orderWindow:NSWindowAbove relativeTo:command->moveAbove]; break;
    case BDWindowCommandAspectRatio:
        aspectRatio = command->aspectRatio.ratio;
        beyondAspectRatio = command->aspectRatio.extra;
        if (aspectRatio > 0)
            window.contentAspectRatio = NSMakeSize(aspectRatio, 1);
        else
            window.resizeIncrements = NSMakeSize(1, 1);
        break;
    case BDWindowCommandInvalidateShadow: [window invalidateShadow]; break;
    case BDWindowCommandTabAction: [NSApp sendAction:NSSelectorFromString(string(command->tabAction)) to:window from:nil]; break;
    case BDWindowCommandAddTab: {
        NSWindow* tab = views[@(command->addTab)].window;
        if (tab)
            [window addTabbedWindow:tab ordered:NSWindowAbove];
        break;
    }
    case BDWindowCommandPreview: {
        previewed = [NSURL fileURLWithPath:string(command->preview.path)];
        previewTitle = string(command->preview.name);
        QLPreviewPanel* panel = [classIn(@"Quartz", @"QLPreviewPanel") sharedPreviewPanel];
        [panel makeKeyAndOrderFront:nil];
        [panel reloadData];
        break;
    }
    case BDWindowCommandTouchBar: window.touchBar = touchBar(command->touchBar.items, command->touchBar.escape); break;
    case BDWindowCommandClosePreview:
        if ([NSClassFromString(@"QLPreviewPanel") sharedPreviewPanelExists])
            [[NSClassFromString(@"QLPreviewPanel") sharedPreviewPanel] close];
        break;
    case BDWindowCommandBeep: NSBeep(); break;
    case BDWindowCommandEdited: window.documentEdited = command->edited; break;
    case BDWindowCommandRepresentedFilename: window.representedFilename = string(command->representedFilename); break;
    case BDWindowCommandTrafficLights: trafficLights = (BDMaybePoint) { true, command->trafficLights }; break;
    case BDWindowCommandCharacterPalette: [NSApp orderFrontCharacterPalette:nil]; break;
    case BDWindowCommandLookUp: [self lookUp:string(command->lookUp)]; break;
    }
    [self placeTrafficLights];
}

- (void)titleWasDoubleClicked
{
    NSString* action = [NSUserDefaults.standardUserDefaults stringForKey:@"AppleActionOnDoubleClick"];
    if ([action isEqual:@"Minimize"])
        [owned performMiniaturize:nil];
    else if (![action isEqual:@"None"] && owned.styleMask & NSWindowStyleMaskResizable)
        [owned zoom:nil];
}

- (void)startMove
{
    if (lastPress)
        [owned performWindowDragWithEvent:lastPress];
}

// ───────────────────────────── the pointer ─────────────────────────────

- (BOOL)acceptsFirstResponder { return YES; }
- (BOOL)mouseDownCanMoveWindow { return NO; }
/// The window server would otherwise drag the window by whatever is under its invisible title bar.
- (NSRect)_opaqueRectForWindowMoveWhenInTitlebar { return ownsTitleBar ? self.bounds : NSZeroRect; }

- (BDInput)input:(BDInputKind)kind at:(NSPoint)inWindow
{
    NSPoint at = [self convertPoint:inWindow fromView:nil];
    return (BDInput) { .kind = kind, .x = at.x, .y = self.bounds.size.height - at.y };
}

- (void)send:(BDInputKind)kind event:(NSEvent*)event
{
    BDInput input = [self input:kind at:event.locationInWindow];
    input.modifiers = modifiersOf(event.modifierFlags);
    if (kind == BDMouseDown || kind == BDMouseUp) {
        input.button = event.buttonNumber == 1 ? 2 : event.buttonNumber == 2 ? 1 : MIN(event.buttonNumber, 4);
        input.clicks = MAX(event.clickCount, 1);
    } else if (kind == BDMouseMove)
        input.flag = event.type != NSEventTypeMouseMoved && event.type != NSEventTypeMouseEntered;
    else if (kind != BDMouseLeave) {
        NSEventPhase phase = event.phase;
        input.phase = phase & (NSEventPhaseBegan | NSEventPhaseMayBegin) ? 0 : phase & NSEventPhaseEnded ? 2 : phase & NSEventPhaseCancelled ? 3 : 1;
        input.flag = kind == BDScroll && event.hasPreciseScrollingDeltas;
        input.deltaX = kind == BDScroll ? event.scrollingDeltaX : event.magnification;
        input.deltaY = kind == BDScroll ? event.scrollingDeltaY : 0;
    }
    if (!isClosing)
        bd_input(_number, &input, (BDListText) {});
}

- (BOOL)acceptsFirstMouse:(NSEvent*)event
{
    BDInput input = [self input:BDMouseDown at:event.locationInWindow];
    return !event || bd_accepts_first_mouse(_number, input.x, input.y);
}

- (void)mouseDown:(NSEvent*)event
{
    bd_trace("mouseDown", CACurrentMediaTime() - event.timestamp);
    lastPress = event;
    isPressed = true;
    // The palette of accents and the candidates go away. What was composed goes where the caret is now.
    bool waits = self.hasMarkedText;
    if (!waits)
        [self send:BDMouseDown event:event];
    [self.inputContext handleEvent:event];
    bd_trace("the input method is done", CACurrentMediaTime() - event.timestamp);
    if (waits)
        [self send:BDMouseDown event:event];
}

- (void)rightMouseDown:(NSEvent*)event { [self send:BDMouseDown event:event]; }
- (void)otherMouseDown:(NSEvent*)event { [self send:BDMouseDown event:event]; }
- (void)mouseUp:(NSEvent*)event
{
    bd_trace("mouseUp", CACurrentMediaTime() - event.timestamp);
    isPressed = false;
    [self send:BDMouseUp event:event];
}
- (void)rightMouseUp:(NSEvent*)event { [self send:BDMouseUp event:event]; }
- (void)otherMouseUp:(NSEvent*)event { [self send:BDMouseUp event:event]; }
- (void)mouseDragged:(NSEvent*)event { [self send:BDMouseMove event:event]; }
- (void)rightMouseDragged:(NSEvent*)event { [self send:BDMouseMove event:event]; }
- (void)otherMouseDragged:(NSEvent*)event { [self send:BDMouseMove event:event]; }
- (void)scrollWheel:(NSEvent*)event
{
    bd_trace("scroll event", NSProcessInfo.processInfo.systemUptime - event.timestamp);
    lastScroll = CACurrentMediaTime();
    [self send:BDScroll event:event];
}
- (void)magnifyWithEvent:(NSEvent*)event { [self send:BDPinch event:event]; }

/// The tracking area does not care what is in front of the window.
- (void)mouseMoved:(NSEvent*)event
{
    bool isCovered = !owned.isKeyWindow && [NSWindow windowNumberAtPoint:NSEvent.mouseLocation belowWindowWithWindowNumber:0] != owned.windowNumber;
    if (isCovered || owned.attachedSheet) {
        if (hasMouse)
            [self mouseExited:event];
        return;
    }
    hasMouse = true;
    [self send:BDMouseMove event:event];
}

- (void)mouseEntered:(NSEvent*)event { [self mouseMoved:event]; }

- (void)mouseExited:(NSEvent*)event
{
    hasMouse = false;
    [self send:BDMouseLeave event:event];
}

- (void)swipeWithEvent:(NSEvent*)event
{
    if (event.deltaX || event.deltaY)
        [self send:event(BDWindowEventSwipe, .swipe = event.deltaX > 0 ? BDDirectionLeft : event.deltaX < 0 ? BDDirectionRight : event.deltaY > 0 ? BDDirectionUp : BDDirectionDown)];
}

- (void)resetCursorRects { [self addCursorRect:self.bounds cursor:cursor]; }

- (void)setCursor:(uint8_t)index
{
    if (cursor == cursorAt(index))
        return;
    cursor = cursorAt(index);
    // AppKit shows what a drop would do.
    if (isDragging)
        return;
    [owned invalidateCursorRectsForView:self];
    if (hasMouse)
        [cursor set];
}

- (void)send:(BDInputKind)kind drag:(id<NSDraggingInfo>)drag
{
    BDInput input = [self input:kind at:drag.draggingLocation];
    NSArray* files;
    if (kind == BDDragEnter)
        files = [drag.draggingPasteboard readObjectsForClasses:@[ NSURL.class ] options:@{ NSPasteboardURLReadingFileURLsOnlyKey : @YES }];
    if (!isClosing)
        bd_input(_number, &input, textsOf([files valueForKey:@"path"]));
}

/// There are no events of the mouse in the meantime.
- (void)send:(BDInputKind)kind whileDraggingAt:(NSPoint)inWindow
{
    BDInput input = [self input:kind at:inWindow];
    input.modifiers = modifiersOf(NSEvent.modifierFlags);
    input.flag = input.clicks = 1;
    if (!isClosing)
        bd_input(_number, &input, (BDListText) {});
}

- (NSDragOperation)handle:(BDInputKind)kind drag:(id<NSDraggingInfo>)drag
{
    if (drag.draggingSource != self) {
        [self send:kind drag:drag];
        return [drag.draggingPasteboard availableTypeFromArray:@[ NSPasteboardTypeFileURL ]] ? NSDragOperationCopy : NSDragOperationNone;
    }
    isDragInside = kind != BDDragLeave;
    if (isDragInside && !wasDropped)
        [self send:kind == BDDrop ? BDMouseUp : BDMouseMove whileDraggingAt:drag.draggingLocation];
    wasDropped |= kind == BDDrop;
    return cursor == cursorAt(BDCursorDragCopy) ? NSDragOperationCopy
        : cursor == cursorAt(BDCursorDragLink)  ? NSDragOperationLink
        : cursor == cursorAt(BDCursorClosedHand) ? NSDragOperationMove
                                                 : NSDragOperationNone;
}

- (NSDragOperation)draggingEntered:(id<NSDraggingInfo>)drag { return [self handle:BDDragEnter drag:drag]; }
- (NSDragOperation)draggingUpdated:(id<NSDraggingInfo>)drag { return [self handle:BDDragOver drag:drag]; }
- (void)draggingExited:(id<NSDraggingInfo>)drag { [self handle:BDDragLeave drag:drag]; }
- (void)draggingEnded:(id<NSDraggingInfo>)drag { [self handle:BDDragLeave drag:drag]; }
- (BOOL)performDragOperation:(id<NSDraggingInfo>)drag { return [self handle:BDDrop drag:drag], YES; }

- (void)beginDrag:(const BDDragged*)dragged image:(NSImage*)image
{
    NSPasteboardItem* contents = [NSPasteboardItem new];
    [contents setString:@"" forType:draggedByPage];
    if (dragged->text.bytes.length)
        [contents setString:string(dragged->text) forType:NSPasteboardTypeString];
    if (dragged->html.bytes.length)
        [contents setString:[@"<meta charset='utf-8'>" stringByAppendingString:string(dragged->html)] forType:NSPasteboardTypeHTML];
    if (dragged->url.bytes.length)
        [contents setString:string(dragged->url) forType:NSPasteboardTypeURL];
    NSDragOperation allowed = (dragged->copies ? NSDragOperationCopy : 0) | (dragged->links ? NSDragOperationLink : 0);
    [self drag:@[ contents ] image:image area:dragged->area allowed:allowed];
}

- (void)dragFiles:(NSArray<NSString*>*)paths icon:(NSImage*)icon
{
    NSMutableArray* files = [NSMutableArray new];
    for (NSString* path in paths)
        [files addObject:[NSURL fileURLWithPath:path]];
    [self drag:files image:icon area:(BDRect) { 0, 0, icon.size.width, icon.size.height } allowed:NSDragOperationCopy];
}

- (void)drag:(NSArray*)contents image:(NSImage*)image area:(BDRect)area allowed:(NSDragOperation)allowed
{
    soon(^{
        // It may be over, or not be done with the mouse.
        if (self->isClosing || !self->isPressed || !(NSEvent.pressedMouseButtons & 1))
            return;
        NSPoint inWindow = self->owned.mouseLocationOutsideOfEventStream, at = [self convertPoint:inWindow fromView:nil];
        NSMutableArray* items = [NSMutableArray new];
        for (id<NSPasteboardWriting> it in contents) {
            NSDraggingItem* item = [[NSDraggingItem alloc] initWithPasteboardWriter:it];
            [item setDraggingFrame:NSMakeRect(at.x + area.x, at.y - area.y - area.height, MAX(area.width, 1), MAX(area.height, 1)) contents:image];
            [items addObject:item];
        }
        NSEvent* event = [NSEvent mouseEventWithType:NSEventTypeLeftMouseDragged location:inWindow modifierFlags:0
                                           timestamp:NSProcessInfo.processInfo.systemUptime windowNumber:self->owned.windowNumber
                                             context:nil eventNumber:0 clickCount:1 pressure:1];
        self->isPressed = self->wasDropped = false;
        self->isDragging = true;
        self->isDragInside = NSPointInRect(at, self.bounds);
        self->allowedElsewhere = allowed;
        [self beginDraggingSessionWithItems:items event:event source:self];
    });
}

- (NSDragOperation)draggingSession:(NSDraggingSession*)session sourceOperationMaskForDraggingContext:(NSDraggingContext)context
{
    return context == NSDraggingContextWithinApplication ? NSDragOperationCopy | NSDragOperationLink | NSDragOperationMove : allowedElsewhere;
}

/// Something may be in front of the window.
- (void)dragIsElsewhere:(NSPoint)onScreen
{
    NSPoint inWindow = [owned convertPointFromScreen:onScreen];
    bool isOverPage = NSPointInRect([self convertPoint:inWindow fromView:nil], self.bounds);
    [self send:BDMouseMove whileDraggingAt:isOverPage ? NSMakePoint(-1e4, 1e4) : inWindow];
}

- (void)draggingSession:(NSDraggingSession*)session movedToPoint:(NSPoint)point
{
    if (!isDragInside)
        [self dragIsElsewhere:point];
}

- (void)draggingSession:(NSDraggingSession*)session endedAtPoint:(NSPoint)point operation:(NSDragOperation)operation
{
    isDragging = false;
    [owned invalidateCursorRectsForView:self];
    if (wasDropped)
        return;
    [self dragIsElsewhere:point];
    [self send:BDMouseUp whileDraggingAt:[owned convertPointFromScreen:point]];
}

// ───────────────────────────── keys ─────────────────────────────

/// The page sees shortcuts before the menus do.
- (BOOL)performKeyEquivalent:(NSEvent*)event
{
    if (event.type != NSEventTypeKeyDown || !isShortcut(event) || !owned.isKeyWindow || owned.firstResponder != self || self.hasMarkedText)
        return NO;
    if (event == sentEquivalent)
        return NO;
    sentEquivalent = event;
    reportKey(event);
    // The item lights up, and VoiceOver names it.
    bool edits = event.modifierFlags & NSEventModifierFlagCommand && [@"cvxz" containsString:event.charactersIgnoringModifiers.lowercaseString];
    return bd_key(true) && !edits;
}

- (bool)sendPendingKey
{
    if (!keyIsPending)
        return false;
    keyIsPending = false;
    return bd_key(true);
}

- (void)keyDown:(NSEvent*)event
{
    if (event == sentEquivalent)
        return;
    reportKey(event);
    NSTextInputContext* context = self.inputContext;
    wasComposing = self.hasMarkedText;
    if (!context || (isShortcut(event) && !wasComposing)) {
        NSString* typed = event.characters;
        bool types = !isShortcut(event) && typed.length && ([typed characterAtIndex:0] & 0xFF00) != 0xF700;
        if (!bd_key(true) && types)
            bd_text_insert(_number, toRange(NSMakeRange(NSNotFound, 0)), typed.UTF8String ?: "");
        return;
    }
    isInKeyDown = keyIsPending = true;
    hasCommitted = false;
    lastKey = event;
    bd_trace("keyDown", CACurrentMediaTime() - event.timestamp);
    [context handleEvent:event];
    bd_trace("the input method is done", CACurrentMediaTime() - event.timestamp);
    isInKeyDown = false;
    if (keyIsPending && (wasComposing || self.hasMarkedText)) {
        keyIsPending = false;
        bd_key_was_taken();
    }
    [self sendPendingKey];
}

- (void)keyUp:(NSEvent*)event
{
    reportKey(event);
    bd_key(false);
}

- (void)flagsChanged:(NSEvent*)event
{
    // From 0x36: the `NX_DEVICE*KEYMASK` of the key, which events that programs post lack, and its flag.
    static const NSUInteger masks[][2] = { { 0x10, 1 << 20 }, { 0x08, 1 << 20 }, { 0x02, 1 << 17 }, { 1 << 16, 1 << 16 }, { 0x20, 1 << 19 },
        { 0x01, 1 << 18 }, { 0x04, 1 << 17 }, { 0x40, 1 << 19 }, { 0x2000, 1 << 18 }, { 1 << 23, 1 << 23 } };
    NSUInteger flags = event.modifierFlags;
    if (event.type == NSEventTypeFlagsChanged && event.keyCode >= 0x36 && event.keyCode <= 0x3F)
        bd_raw_key(flags & masks[event.keyCode - 0x36][!(flags & 0x207F)], false, event.keyCode, 0, modifiersOf(event.modifierFlags));
}

- (NSTextInputContext*)inputContext { return !_hasMenu && bd_text_is_enabled(_number) ? super.inputContext : nil; }

/// The first key after a pop-up menu skips the input method, unless its context is activated again.
- (void)setHasMenu:(bool)hasMenu
{
    [NSObject cancelPreviousPerformRequestsWithTarget:super.inputContext selector:@selector(invalidateCharacterCoordinates) object:nil];
    _hasMenu = hasMenu;
    [NSApp updateWindows];
    [self textInputChanged];
}

- (void)textInputChanged
{
    if (_hasMenu || isClosing)
        return;
    updateSecureInput();
    NSTextInputContext* context = super.inputContext;
    if (isComposing && !self.hasMarkedText) {
        isComposing = false;
        ignoresInputMethod = true;
        [context discardMarkedText];
        ignoresInputMethod = false;
    }
    bool hasTextInput = bd_text_is_enabled(_number);
    if (hasTextInput != hadTextInput) {
        hadTextInput = hasTextInput;
        // This is when AppKit looks for another context.
        whenIdle(^{
            [NSApp updateWindows];
        });
    }
    if (isComposing)
        return [context invalidateCharacterCoordinates];
    // It talks to other processes, which is not to hold up what was typed.
    [NSObject cancelPreviousPerformRequestsWithTarget:context selector:@selector(invalidateCharacterCoordinates) object:nil];
    if (hasTextInput)
        [context performSelector:@selector(invalidateCharacterCoordinates) withObject:nil afterDelay:0.05];
}

- (void)insertText:(id)string replacementRange:(NSRange)range
{
    if (ignoresInputMethod)
        return;
    bool isTyped = isInKeyDown && !wasComposing && !self.hasMarkedText && range.location == NSNotFound;
    isComposing = false;
    if (isTyped && [self sendPendingKey])
        return;
    // A key that ends a composition may still have a command.
    keyIsPending &= wasComposing;
    hasCommitted = keyIsPending;
    bd_text_insert(_number, toRange(range), plain(string).UTF8String ?: "");
}

- (void)setMarkedText:(id)string selectedRange:(NSRange)selection replacementRange:(NSRange)range
{
    if (ignoresInputMethod)
        return;
    bd_text_compose(_number, toRange(range), plain(string).UTF8String ?: "", toRange(selection));
    isComposing = self.hasMarkedText;
}

- (void)unmarkText
{
    isComposing = false;
    if (!ignoresInputMethod)
        bd_text_end_composition(_number);
}

- (void)doCommandBySelector:(SEL)selector
{
    // What was committed has used up the report.
    if (keyIsPending && hasCommitted && !self.hasMarkedText)
        reportKey(lastKey);
    [self sendPendingKey];
}
- (BOOL)hasMarkedText { return bd_text_range(_number, true).start >= 0; }
- (NSRange)markedRange { return fromRange(bd_text_range(_number, true)); }
- (NSRange)selectedRange { return fromRange(bd_text_range(_number, false)); }
- (NSArray<NSAttributedStringKey>*)validAttributesForMarkedText { return @[]; }
- (NSUInteger)characterIndexForPoint:(NSPoint)point { return self.selectedRange.location; }

- (NSAttributedString*)attributedSubstringForProposedRange:(NSRange)proposed actualRange:(NSRangePointer)actual
{
    if (proposed.location == NSNotFound)
        return nil;
    BDRange range = { proposed.location, proposed.location + MIN(proposed.length, 1 << 30) };
    BDListu16 units = bd_text(_number, &range);
    NSString* string = [NSString stringWithCharacters:units.start length:units.length];
    bd_free_units(units);
    if (actual)
        *actual = fromRange(range);
    return string.length ? [[NSAttributedString alloc] initWithString:string] : nil;
}

- (NSRect)firstRectForCharacterRange:(NSRange)range actualRange:(NSRangePointer)actual
{
    BDRect caret = bd_text_caret(_number);
    NSRect rect = NSMakeRect(caret.x, self.bounds.size.height - caret.y - caret.height, caret.width, caret.height);
    if (actual)
        *actual = range;
    return [owned convertRectToScreen:[self convertRect:rect toView:nil]];
}

// ───────────────────────────── accessibility ─────────────────────────────

- (BOOL)isAccessibilityElement { return YES; }
- (NSAccessibilityRole)accessibilityRole { return NSAccessibilityGroupRole; }
- (id)accessibilityFocusedUIElement { return CFBridgingRelease(bd_accessibility_focus(_number)) ?: self; }

- (NSArray*)accessibilityChildren
{
    bd_accessibility_was_used(_number);
    return CFBridgingRelease(bd_accessibility_roots(_number)) ?: @[];
}

- (id)accessibilityHitTest:(NSPoint)point
{
    bd_accessibility_was_used(_number);
    return accessibleAt(_number, 0, point) ?: self;
}

@end

// ───────────────────────────── for Rust ─────────────────────────────

#define view ((__bridge BunDesktopView*)pointer)

void* bd_window_open(const BDWindowOptions* options)
{
    @autoreleasepool {
        @try {
            return (__bridge_retained void*)[[BunDesktopView alloc] initWithOptions:options];
        } @catch (NSException* exception) {
            bd_log(exception.description.UTF8String);
            return NULL;
        }
    }
}

char* bd_window_command(void* pointer, const BDWindowCommand* command)
{
    return attempt(^{
        [view execute:command];
    });
}

BDListBackdropPart bd_window_describe_backdrop(void* pointer)
{
    @autoreleasepool {
        NSArray<NSArray<NSNumber*>*>* found = view.describeBackdrop;
        BDListBackdropPart parts = listOf(BackdropPart, found.count);
        forEach(part, parts) {
            NSArray<NSNumber*>* numbers = found[part - parts.start];
            part->color.has = numbers.count > 4;
            for (int index = 0; index < numbers.count; index++)
                (index < 4 ? part->frame.at : part->color.value.at)[index % 4] = numbers[index].doubleValue;
        }
        return parts;
    }
}

void displaysChanged(void)
{
    for (BunDesktopView* it in views.allValues)
        [it windowDidChangeScreen:[NSNotification notificationWithName:NSWindowDidChangeScreenNotification object:it.window]];
}

void bd_window_imitate_backdrop(void* pointer, const BDBackdropPart* parts, size_t count)
{
    free(attempt(^{
        [view imitateBackdrop:parts count:count];
        [view placeTrafficLights];
    }));
}

bool bd_window_is_minimized(void* pointer) { return view.window.isMiniaturized; }
uint64_t bd_window_number(void* pointer) { return view.window.windowNumber; }

typedef enum : uint8_t { Close, Hide, Show, ShowAndFocus, TextInputChanged, StartMove, TitleWasDoubleClicked, ClaimBackground } Action;

void bd_window_act(void* pointer, Action action)
{
    char* error = attempt(^{
        switch (action) {
        case Close: [view close]; break;
        case Hide: [view setVisible:false focus:false]; break;
        case Show: [view setVisible:true focus:false]; break;
        case ShowAndFocus: [view setVisible:true focus:true]; break;
        case TextInputChanged: [view textInputChanged]; break;
        case StartMove: [view startMove]; break;
        case TitleWasDoubleClicked: [view titleWasDoubleClicked]; break;
        case ClaimBackground: [view claimBackground]; break;
        }
    });
    if (error)
        bd_log(error);
    free(error);
}

BDGeometry bd_window_geometry(void* pointer)
{
    @autoreleasepool {
        return view.geometry;
    }
}

BDRect bd_window_mouse(void* pointer)
{
    BDInput input = [view input:BDMouseMove at:view.window.mouseLocationOutsideOfEventStream];
    return (BDRect) { input.x, input.y };
}

void bd_window_set_cursor(void* pointer, uint8_t index)
{
    @autoreleasepool {
        [view setCursor:index];
    }
}

void bd_window_begin_drag(void* pointer, const BDDragged* dragged, const uint8_t* rgba, uint32_t width, uint32_t height)
{
    @autoreleasepool {
        NSImage* image;
        if (rgba) {
            NSBitmapImageRep* pixels = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:width pixelsHigh:height bitsPerSample:8
                                                                          samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSCalibratedRGBColorSpace
                                                                              bytesPerRow:width * 4 bitsPerPixel:32];
            memcpy(pixels.bitmapData, rgba, (size_t)width * height * 4);
            image = [[NSImage alloc] initWithSize:NSMakeSize(dragged->area.width, dragged->area.height)];
            pixels = [pixels bitmapImageRepByRetaggingWithColorSpace:NSColorSpace.sRGBColorSpace];
            pixels.size = image.size;
            [image addRepresentation:pixels];
        }
        [view beginDrag:dragged image:image];
    }
}

float bd_window_frequency(void* pointer) { return view.frequency; }
bool bd_window_is_active(void* pointer) { return view.window.isKeyWindow; }
bool bd_window_is_visible(void* pointer) { return view.needsFrames; }
void bd_window_request_frame(void* pointer, bool isLeisurely) { [view requestFrame:isLeisurely]; }
void bd_window_set_scrolling(void* pointer, bool isOn) { [view setScrolling:isOn]; }
bool bd_window_is_too_late(void* pointer) { return view.isTooLate; }
void* bd_window_layer(void* pointer) { return (__bridge void*)view.layer; }
void bd_window_fit_backdrop(void* pointer, double* edges)
{
    @autoreleasepool {
        @try {
            [view fitBackdrop:edges];
        } @catch (NSException* exception) {
            edges[0] = edges[1] = 0;
        }
    }
}

void* bd_window_content_view(void* pointer) { return (__bridge void*)view.superview; }
