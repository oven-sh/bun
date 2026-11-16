// A window, and the view that fills it.
#import "bridge.h"
#import <mach/mach_time.h>
#import <QuartzCore/QuartzCore.h>
#import <objc/message.h>

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

static uint8_t modifiersOf(NSEvent* event)
{
    NSEventModifierFlags flags = event.modifierFlags;
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
    bd_raw_key(event.type == NSEventTypeKeyDown, event.isARepeat, event.keyCode, symbol, modifiersOf(event));
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

static NSCursor* unlisted(NSString* name)
{
    SEL selector = NSSelectorFromString(name);
    return [NSCursor respondsToSelector:selector] ? ((id (*)(id, SEL))objc_msgSend)(NSCursor.class, selector) : NSCursor.arrowCursor;
}

/// In the order of `platform::Cursor`.
static NSCursor* cursorAt(uint8_t index)
{
    static NSArray* cursors;
    cursors = cursors ?: @[
        NSCursor.arrowCursor, NSCursor.IBeamCursor, NSCursor.IBeamCursorForVerticalLayout, NSCursor.crosshairCursor,
        NSCursor.openHandCursor, NSCursor.closedHandCursor, NSCursor.pointingHandCursor, NSCursor.resizeLeftCursor,
        NSCursor.resizeRightCursor, NSCursor.resizeLeftRightCursor, NSCursor.resizeUpCursor, NSCursor.resizeDownCursor,
        NSCursor.resizeUpDownCursor, unlisted(@"_windowResizeNorthWestSouthEastCursor"), unlisted(@"_windowResizeNorthEastSouthWestCursor"),
        NSCursor.resizeLeftRightCursor, NSCursor.resizeUpDownCursor, NSCursor.operationNotAllowedCursor, NSCursor.dragLinkCursor,
        NSCursor.dragCopyCursor, NSCursor.contextualMenuCursor,
        [[NSCursor alloc] initWithImage:[[NSImage alloc] initWithSize:NSMakeSize(1, 1)] hotSpot:NSZeroPoint],
    ];
    return cursors[index];
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
- (void)scrolls;
@end

@implementation BunDesktopClock {
    CVDisplayLinkRef link;
    CFRunLoopSourceRef ticks;
    /// Refreshes are not worth waking up for until then.
    _Atomic CFTimeInterval restsUntil;
    /// It knows when a frame has to begin to be in time.
    CADisplayLink* model;
    _Atomic CFTimeInterval lastRefresh, period, delay;
    _Atomic CFTimeInterval comparedAt;
    CFTimeInterval delays[5];
    _Atomic int comparisons, refreshes;
    CADisplayLink* pacer;
    CFTimeInterval scrolledAt;
    _Atomic bool isPaced;
    NSHashTable<BunDesktopView*>* listeners;
}

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"

/// In seconds after a refresh. The first is negative for whenever there is something.
static double commitAt = -1, fixedTickAt = -1;
static bool commitsOnMainThread, followsModel;
static int runningClocks;

bool commitsInTime(void) { return commitAt >= 0 && runningClocks; }

static void tickAll(void* clock);
static void commit(void* unused) { commitWhatIsReady(); }

static void commitAfter(const CVTimeStamp* refresh, double seconds)
{
    if (seconds > 0)
        mach_wait_until(refresh->hostTime + seconds * CVGetHostClockFrequency());
    if (commitsOnMainThread)
        dispatch_async_f(dispatch_get_main_queue(), NULL, commit);
    else
        commitWhatIsReady();
}

static CVReturn displayIsReady(CVDisplayLinkRef link, const CVTimeStamp* now, const CVTimeStamp* shownAt, CVOptionFlags flags,
    CVOptionFlags* out, void* context)
{
    __unsafe_unretained BunDesktopClock* clock = (__bridge BunDesktopClock*)context;
    clock->lastRefresh = now->hostTime / CVGetHostClockFrequency();
    clock->period = shownAt->videoTimeScale ? (double)shownAt->videoRefreshPeriod / shownAt->videoTimeScale : 0;
    if ((followsModel && clock->model) || clock->isPaced)
        return kCVReturnSuccess;
    double untilShown = ((double)shownAt->hostTime - now->hostTime) / CVGetHostClockFrequency();
    if (++clock->refreshes == 10) {
        bd_trace("the link is late by", CACurrentMediaTime() - clock->lastRefresh);
        bd_trace("the link is ahead by", untilShown);
        bd_trace("the system has started", CACurrentMediaTime());
        // What answers a key is not to be held up by the model.
        if (!clock->comparedAt || clock->lastRefresh > clock->comparedAt + 60) {
            clock->comparisons = 0;
            clock->model.paused = NO;
        }
    }
    double tickAt = fixedTickAt >= 0 ? fixedTickAt : clock->model || !clock->period ? clock->delay : fmod(untilShown, clock->period);
    if (fixedTickAt < 0 && tickAt > clock->period * 7 / 8)
        tickAt = 0;
    bool commitsFirst = commitAt >= 0 && commitAt <= tickAt;
    if (commitsFirst)
        commitAfter(now, commitAt);
    if (tickAt > 0)
        mach_wait_until(now->hostTime + tickAt * CVGetHostClockFrequency());
    [clock tick];
    if (commitAt > tickAt)
        commitAfter(now, commitAt);
    return kCVReturnSuccess;
}

- (void)tick
{
    if (CACurrentMediaTime() >= restsUntil) {
        restsUntil = CACurrentMediaTime() + 0.011;
        CFRunLoopSourceSignal(ticks);
        CFRunLoopWakeUp(CFRunLoopGetMain());
    }
}

- (void)scrolls
{
    scrolledAt = CACurrentMediaTime();
    pacer.paused = NO;
}

- (void)pacerTicks:(CADisplayLink*)sender
{
    isPaced = CACurrentMediaTime() < scrolledAt + 0.1;
    sender.paused = !isPaced;
    tickAll((__bridge void*)self);
}

static int compare(const void* a, const void* b) { return *(const double*)a < *(const double*)b ? -1 : 1; }

- (void)modelTicks:(CADisplayLink*)sender
{
    if (followsModel)
        return [self tick];
    // The first ones are not regular.
    if (++comparisons <= 2 || !period)
        return;
    delays[(comparisons - 3) % 5] = fmod(CACurrentMediaTime() - lastRefresh + period, period);
    if (comparisons < 7)
        return;
    sender.paused = YES;
    qsort(delays, 5, sizeof *delays, compare);
    if (delays[3] - delays[1] > period / 8)
        return;
    comparedAt = CACurrentMediaTime();
    delay = delays[1];
    bd_trace("frames begin", delay);
}

static NSRunLoop* otherRunLoop(void)
{
    static NSRunLoop* loop;
    if (!loop) {
        dispatch_semaphore_t isReady = dispatch_semaphore_create(0);
        NSThread* thread = [[NSThread alloc] initWithBlock:^{
            loop = NSRunLoop.currentRunLoop;
            [loop addPort:NSMachPort.port forMode:NSDefaultRunLoopMode];
            dispatch_semaphore_signal(isReady);
            [loop run];
        }];
        thread.qualityOfService = NSQualityOfServiceUserInteractive;
        [thread start];
        dispatch_semaphore_wait(isReady, DISPATCH_TIME_FOREVER);
    }
    return loop;
}

static void tickAll(void* clock)
{
    @autoreleasepool {
        for (BunDesktopView* view in ((__bridge BunDesktopClock*)clock)->listeners.allObjects)
            [view tick:nil];
    }
}

+ (instancetype)ofScreen:(NSScreen*)screen
{
    static NSMutableDictionary<NSNumber*, BunDesktopClock*>* clocks;
    NSNumber* display = screen.deviceDescription[@"NSScreenNumber"];
    if (clocks[display])
        return clocks[display];
    const char *when = getenv("BUN_DESKTOP_COMMIT") ?: "now", *shift = getenv("BUN_DESKTOP_TICK_SHIFT") ?: getenv("BUN_DESKTOP_CA_CLOCK") ? "-1" : "0";
    commitAt = !strcmp(when, "next") ? 0 : !strncmp(when, "at:", 3) ? atof(when + 3) / 1000 : -1;
    fixedTickAt = atof(shift) / 1000;
    followsModel = getenv("BUN_DESKTOP_CA_CLOCK");
    commitsOnMainThread = getenv("BUN_DESKTOP_COMMIT_ON_MAIN");
    BunDesktopClock* clock = [BunDesktopClock new];
    if (CVDisplayLinkCreateWithCGDisplay(display.unsignedIntValue, &clock->link))
        return nil;
    clock->listeners = NSHashTable.weakObjectsHashTable;
    CFRunLoopSourceContext context = { .info = (__bridge void*)clock, .perform = tickAll };
    clock->ticks = CFRunLoopSourceCreate(NULL, 1, &context);
    CFRunLoopAddSource(CFRunLoopGetMain(), clock->ticks, kCFRunLoopCommonModes);
    CVDisplayLinkSetOutputCallback(clock->link, displayIsReady, (__bridge void*)clock);
    if (fixedTickAt == -0.001 && [screen respondsToSelector:@selector(displayLinkWithTarget:selector:)]) {
        float rate = screen.maximumFramesPerSecond ?: 60;
        clock->model = [screen displayLinkWithTarget:clock selector:@selector(modelTicks:)];
        clock->model.preferredFrameRateRange = (CAFrameRateRange) { rate, rate, rate };
        clock->model.paused = YES;
        [clock->model addToRunLoop:otherRunLoop() forMode:NSDefaultRunLoopMode];
    }
    if (!strcmp(getenv("BUN_DESKTOP_SCROLL") ?: "", "ca") && [screen respondsToSelector:@selector(displayLinkWithTarget:selector:)]) {
        float rate = screen.maximumFramesPerSecond ?: 60;
        clock->pacer = [screen displayLinkWithTarget:clock selector:@selector(pacerTicks:)];
        clock->pacer.preferredFrameRateRange = (CAFrameRateRange) { rate, rate, rate };
        clock->pacer.paused = YES;
        [clock->pacer addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
    }
    clocks = clocks ?: [NSMutableDictionary new];
    return clocks[display] = clock;
}

- (void)hurry { restsUntil = 0; }

- (bool)add:(BunDesktopView*)view
{
    [listeners addObject:view];
    if (CVDisplayLinkIsRunning(link))
        return true;
    refreshes = 0;
    bool isRunning = !CVDisplayLinkStart(link);
    runningClocks += isRunning;
    model.paused = !followsModel;
    return isRunning;
}

- (void)remove:(BunDesktopView*)view
{
    [listeners removeObject:view];
    if (!listeners.anyObject && CVDisplayLinkIsRunning(link)) {
        CVDisplayLinkStop(link);
        model.paused = YES;
        runningClocks--;
        commitWhatIsReady();
        [CATransaction flush];
    }
}

#pragma clang diagnostic pop

@end

@implementation BunDesktopView {
    /// The window owns its content view, and this its window until that is closed.
    NSWindow* owned;
    NSVisualEffectView* effect;
    NSView* imitation;
    NSString* background;
    NSNumber* backgroundColor;
    NSArray* trafficLights;
    bool ownsTitleBar, opensFullscreen, isClosing, isFullscreenable, isVisibleOnFullscreen;
    bool isChangingSpace, hadHiddenButtons;
    void (^afterChangingSpace)(void);
    NSRect frameBeforeSimpleFullscreen;
    NSWindowStyleMask styleBeforeSimpleFullscreen;

    BunDesktopClock* clock;
    bool wantsFrame, isAwake, wasSeen, wasVisible;
    int idleTicks;
    CFTimeInterval lastFrame;

    NSCursor* cursor;
    NSEvent* lastPress;
    bool hasMouse;

    NSEvent *sentEquivalent, *lastKey;
    bool hasCommitted;
    bool isInKeyDown, keyIsPending, wasComposing, isComposing, ignoresInputMethod, hadTextInput;

    BunDesktopTree* tree;
}

+ (BunDesktopView*)withNumber:(id)identifier { return number(identifier) ? views[identifier] : nil; }

- (instancetype)initWithOptions:(NSDictionary*)options
{
    traceLaunch("a window is wanted");
    NSRect content = NSMakeRect(0, 0, [options[@"width"] doubleValue], [options[@"height"] doubleValue]);
    self = [super initWithFrame:content];
    _number = [options[@"id"] unsignedIntValue];
    _isFocusable = true;
    cursor = NSCursor.arrowCursor;
    bool hasFrame = isTrue(options[@"frame"]), floats = [@[ @"popup", @"floating" ] containsObject:options[@"kind"]];
    ownsTitleBar = !hasFrame || isTrue(options[@"hiddenTitleBar"]);
    opensFullscreen = isTrue(options[@"fullscreen"]);
    trafficLights = list(options[@"trafficLightPosition"]);
    NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable
        | (isTrue(options[@"minimizable"]) ? NSWindowStyleMaskMiniaturizable : 0) | (isTrue(options[@"resizable"]) ? NSWindowStyleMaskResizable : 0)
        | (ownsTitleBar ? NSWindowStyleMaskFullSizeContentView : 0) | (floats ? NSWindowStyleMaskNonactivatingPanel : 0);
    Class class = floats ? BunDesktopPanel.class : BunDesktopWindow.class;
    NSWindow* window = owned = [[class alloc] initWithContentRect:content styleMask:style backing:NSBackingStoreBuffered defer:NO];
    window.releasedWhenClosed = NO;
    window.restorable = NO;
    window.hidesOnDeactivate = NO;
    window.tabbingMode = NSWindowTabbingModeDisallowed;
    window.animationBehavior = NSWindowAnimationBehaviorNone;
    window.title = text(options[@"title"]) ?: @"";
    window.movable = isTrue(options[@"movable"]);
    window.contentMinSize = NSMakeSize([options[@"minWidth"] doubleValue], [options[@"minHeight"] doubleValue]);
    if (ownsTitleBar) {
        window.titlebarAppearsTransparent = YES;
        window.titleVisibility = NSWindowTitleHidden;
    }
    for (NSButton* button in buttonsOf(window))
        button.hidden = !hasFrame;
    if (floats) {
        window.level = [options[@"kind"] isEqual:@"popup"] ? NSPopUpMenuWindowLevel : NSFloatingWindowLevel;
        window.animationBehavior = NSWindowAnimationBehaviorUtilityWindow;
        window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary;
    }
    [window setFrameTopLeftPoint:NSMakePoint(number(options[@"x"]).doubleValue, primaryHeight() - number(options[@"y"]).doubleValue)];

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
    [self registerForDraggedTypes:@[ NSPasteboardTypeFileURL ]];
    background = options[@"background"];
    backgroundColor = number(options[@"backgroundColor"]);
    [self paintBackground];
    if (isTrue(options[@"maximized"]))
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
    if (window.attachedSheet)
        [window endSheet:window.attachedSheet];
    // AppKit may be in the middle of telling it something.
    if (!isFullscreen(window) && !isChangingSpace)
        [window orderOut:nil];
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

- (void)report:(BDWindowEvent)event
{
    if (!isClosing)
        bd_window_event(_number, event);
}

- (void)emit:(NSString*)event value:(id)value
{
    if (!isClosing)
        emit(@{ @"t" : @"window", @"w" : @(_number), @"e" : event, @"v" : value });
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
    return (BDGeometry) { frame.origin.x, primaryHeight() - NSMaxY(frame), frame.size.height - size.height, size.width, size.height,
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

- (void)imitateBackdrop:(NSArray<NSArray<NSNumber*>*>*)parts
{
    [imitation removeFromSuperview];
    imitation = nil;
    if (!parts.count)
        return;
    imitation = [[NSView alloc] initWithFrame:self.frame];
    bool blurs = false;
    for (NSArray<NSNumber*>* part in parts) {
        NSRect frame = NSMakeRect(part[0].doubleValue, part[1].doubleValue, part[2].doubleValue, part[3].doubleValue);
        if (part.count > 4) {
            NSView* view = [[NSView alloc] initWithFrame:frame];
            view.wantsLayer = YES;
            view.layer.backgroundColor =
                [NSColor colorWithSRGBRed:part[4].doubleValue green:part[5].doubleValue blue:part[6].doubleValue alpha:part[7].doubleValue].CGColor;
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

- (void)paintBackground
{
    bool isOpaque = [background isEqual:@"opaque"];
    uint32_t color = backgroundColor.unsignedIntValue;
    owned.opaque = isOpaque;
    if (!isOpaque)
        owned.backgroundColor = NSColor.clearColor;
    else if (backgroundColor)
        owned.backgroundColor = [NSColor colorWithSRGBRed:(color >> 24) / 255. green:(color >> 16 & 255) / 255. blue:(color >> 8 & 255) / 255. alpha:(color & 255) / 255.];
    else
        owned.backgroundColor = NSColor.windowBackgroundColor;
    NSArray* parts = [background componentsSeparatedByString:@":"];
    if (parts.count != 3) {
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
    NSNumber* material = @{
        @"titlebar" : @(NSVisualEffectMaterialTitlebar), @"selection" : @(NSVisualEffectMaterialSelection),
        @"menu" : @(NSVisualEffectMaterialMenu), @"popover" : @(NSVisualEffectMaterialPopover),
        @"sidebar" : @(NSVisualEffectMaterialSidebar), @"header" : @(NSVisualEffectMaterialHeaderView),
        @"sheet" : @(NSVisualEffectMaterialSheet), @"window" : @(NSVisualEffectMaterialWindowBackground),
        @"hud" : @(NSVisualEffectMaterialHUDWindow), @"fullscreen-ui" : @(NSVisualEffectMaterialFullScreenUI),
        @"tooltip" : @(NSVisualEffectMaterialToolTip), @"content" : @(NSVisualEffectMaterialContentBackground),
        @"under-page" : @(NSVisualEffectMaterialUnderPageBackground),
    }[parts[1]];
    effect.material = material ? material.integerValue : NSVisualEffectMaterialUnderWindowBackground;
    effect.state = [parts[2] isEqual:@"active"] ? NSVisualEffectStateActive
        : [parts[2] isEqual:@"inactive"]        ? NSVisualEffectStateInactive
                                                : NSVisualEffectStateFollowsWindowActiveState;
}

/// AppKit puts them back whenever it lays out the title bar.
- (void)placeTrafficLights
{
    NSArray<NSButton*>* buttons = buttonsOf(owned);
    if (!trafficLights || !buttons || isFullscreen(owned))
        return;
    CGFloat x = [trafficLights[0] doubleValue], y = [trafficLights[1] doubleValue];
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
}

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
    if (isAwake)
        return;
    isAwake = true;
    soon(^{
        if (self->isClosing)
            return;
        if (CACurrentMediaTime() - self->lastFrame < 0.03 || !self.needsFrames)
            return [self startLink];
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
    [self report:BDActivated];
}

- (void)windowDidResignKey:(NSNotification*)notification
{
    [self placeTrafficLights];
    [self report:BDDeactivated];
}

- (void)windowDidBecomeMain:(NSNotification*)notification { [self placeTrafficLights]; }
- (void)windowDidResignMain:(NSNotification*)notification { [self placeTrafficLights]; }
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
    if (trafficLights)
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
    [self emit:@"fullscreen" value:@YES];
}

- (void)windowDidExitFullScreen:(NSNotification*)notification
{
    [self didChangeSpace];
    [self setTrafficLightsHidden:false];
    [self report:BDMoved];
    [self emit:@"fullscreen" value:@NO];
}


- (void)windowDidMiniaturize:(NSNotification*)notification
{
    [self emit:@"minimized" value:@YES];
    [self visibilityMayHaveChanged];
}

- (void)windowDidDeminiaturize:(NSNotification*)notification
{
    [self emit:@"minimized" value:@NO];
    [self visibilityMayHaveChanged];
}

- (void)windowWillStartLiveResize:(NSNotification*)notification { [self emit:@"resizing" value:@YES]; }
- (void)windowDidEndLiveResize:(NSNotification*)notification { [self emit:@"resizing" value:@NO]; }
- (void)windowWillMove:(NSNotification*)notification { [self emit:@"moving" value:@YES]; }

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
        [owned orderOut:nil];
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

- (void)setStyle:(NSDictionary*)style
{
    NSWindow* window = owned;
    void (^flag)(NSString*, void (^)(bool)) = ^(NSString* key, void (^set)(bool)) {
        if (number(style[key]))
            set([style[key] boolValue]);
    };
    __block NSWindowCollectionBehavior behavior = window.collectionBehavior;
    void (^behave)(NSWindowCollectionBehavior, bool) = ^(NSWindowCollectionBehavior bit, bool isOn) {
        behavior = isOn ? behavior | bit : behavior & ~bit;
    };
    flag(@"shadow", ^(bool isOn) { window.hasShadow = isOn; });
    flag(@"movable", ^(bool isOn) { window.movable = isOn; });
    flag(@"focusable", ^(bool isOn) { self.isFocusable = isOn; });
    flag(@"closable", ^(bool isOn) { setStyle(window, NSWindowStyleMaskClosable, isOn); });
    flag(@"minimizable", ^(bool isOn) { setStyle(window, NSWindowStyleMaskMiniaturizable, isOn); });
    flag(@"buttons", ^(bool isOn) { [buttonsOf(window) setValue:@(!isOn) forKey:@"hidden"]; });
    if (isFalse(style[@"roundedCorners"])) {
        setStyle(window, NSWindowStyleMaskTitled, false);
        [window makeFirstResponder:self];
    }
    flag(@"fullScreenable", ^(bool isOn) { self->isFullscreenable = isOn; });
    flag(@"visibleOnFullScreen", ^(bool isOn) { self->isVisibleOnFullscreen = isOn; });
    if (style[@"fullScreenable"] || style[@"visibleOnFullScreen"]) {
        behave(NSWindowCollectionBehaviorFullScreenPrimary, isFullscreenable && !isVisibleOnFullscreen);
        behave(NSWindowCollectionBehaviorFullScreenAuxiliary, !isFullscreenable || isVisibleOnFullscreen);
    }
    flag(@"hiddenInMissionControl", ^(bool isOn) {
        behave(NSWindowCollectionBehaviorManaged | NSWindowCollectionBehaviorStationary, false);
        behave(NSWindowCollectionBehaviorTransient, isOn);
    });
    window.collectionBehavior = behavior;
    flag(@"zoomable", ^(bool isOn) { [window standardWindowButton:NSWindowZoomButton].enabled = isOn; });
    if (number(style[@"level"]))
        window.level = [style[@"level"] integerValue];
}

- (id)command:(NSString*)name value:(id)value other:(NSWindow*)other
{
    NSWindow* window = owned;
    bool isOn = isTrue(value);
    double (^at)(id, int) = ^(id values, int index) {
        return number(member(values, @(index))).doubleValue;
    };
#define is(command) [name isEqual:@command]
    if (is("isMinimized"))
        return window.isMiniaturized ? @YES : @NO;
    if (is("windowNumber"))
        return @(window.windowNumber);
    if (is("describeBackdrop"))
        return self.describeBackdrop;
    if (is("imitateBackdrop"))
        [self imitateBackdrop:list(value)];
    else if (is("title"))
        window.title = text(value) ?: @"";
    else if (is("background") || is("backgroundColor")) {
        background = is("background") ? value : background;
        backgroundColor = is("background") ? backgroundColor : number(value);
        [self paintBackground];
    } else if (is("size"))
        window.contentSize = NSMakeSize(at(value, 0), at(value, 1));
    else if (is("position"))
        window.frameTopLeftPoint = NSMakePoint(at(value, 0), primaryHeight() - at(value, 1));
    else if (is("bounds")) {
        NSRect frame = [window frameRectForContentRect:NSMakeRect(0, 0, at(value, 2), at(value, 3))];
        frame.origin = NSMakePoint(at(value, 0), primaryHeight() - at(value, 1) - frame.size.height);
        [window setFrame:frame display:YES animate:isTrue(member(value, @4))];
    } else if (is("limits")) {
        window.contentMinSize = NSMakeSize(at(value[@"min"], 0), at(value[@"min"], 1));
        window.contentMaxSize = list(value[@"max"]) ? NSMakeSize(at(value[@"max"], 0), at(value[@"max"], 1)) : NSMakeSize(FLT_MAX, FLT_MAX);
        setStyle(window, NSWindowStyleMaskResizable, isTrue(value[@"resizable"]));
    } else if (is("style"))
        [self setStyle:value];
    else if (is("moveTop"))
        [window orderFrontRegardless];
    else if (is("focus")) {
        activateFor(window, false);
        [window makeKeyAndOrderFront:nil];
    } else if (is("sheet")) {
        activateFor(other, true);
        [other beginSheet:window completionHandler:nil];
        [self visibilityMayHaveChanged];
    } else if (is("parent")) {
        [window.sheetParent endSheet:window];
        [window.parentWindow removeChildWindow:window];
        if (window.isVisible)
            [other addChildWindow:window ordered:NSWindowAbove];
    } else if (is("minimize"))
        [self unlessChangingSpace:^{
            [window miniaturize:nil];
        }];
    else if (is("restore"))
        [window deminiaturize:nil];
    else if (is("maximize")) {
        if (self.isMaximized != isOn)
            [window zoom:nil];
    } else if (is("fullscreen")) {
        opensFullscreen = isOn && !window.isVisible;
        if (!opensFullscreen)
            [self unlessChangingSpace:^{
                if (isFullscreen(window) != isOn)
                    [window toggleFullScreen:nil];
            }];
    } else if (is("simpleFullscreen"))
        [self setSimpleFullscreen:isOn];
    else if (is("alwaysOnTop"))
        window.level = isOn ? NSFloatingWindowLevel : NSNormalWindowLevel;
    else if (is("allWorkspaces"))
        window.collectionBehavior = (window.collectionBehavior & ~NSWindowCollectionBehaviorCanJoinAllSpaces) | (isOn ? NSWindowCollectionBehaviorCanJoinAllSpaces : 0);
    else if (is("contentProtection"))
        window.sharingType = isOn ? NSWindowSharingNone : NSWindowSharingReadOnly;
    else if (is("opacity"))
        window.alphaValue = fmax(0, fmin(number(value).doubleValue, 1));
    else if (is("ignoreMouseEvents"))
        window.ignoresMouseEvents = isOn;
    else if (is("attention")) {
        if (!window.isKeyWindow)
            [NSApp requestUserAttention:NSInformationalRequest];
    } else if (is("beep"))
        NSBeep();
    else if (is("edited"))
        window.documentEdited = isOn;
    else if (is("representedFilename"))
        window.representedFilename = text(value) ?: @"";
    else if (is("trafficLightPosition"))
        trafficLights = list(value);
    else if (is("characterPalette"))
        [NSApp orderFrontCharacterPalette:nil];
    else if (is("lookUp")) {
        NSPoint mouse = window.mouseLocationOutsideOfEventStream;
        whenIdle(^{
            [self showDefinitionForAttributedString:[[NSAttributedString alloc] initWithString:text(value) ?: @""] atPoint:mouse];
        });
    }
    [self placeTrafficLights];
    return nil;
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
    input.modifiers = modifiersOf(event);
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
        bd_input(_number, &input, NULL);
}

- (BOOL)acceptsFirstMouse:(NSEvent*)event
{
    BDInput input = [self input:BDMouseDown at:event.locationInWindow];
    return !event || bd_accepts_first_mouse(_number, input.x, input.y);
}

- (void)mouseDown:(NSEvent*)event
{
    lastPress = event;
    // The palette of accents and the candidates go away. What was composed goes where the caret is now.
    bool waits = self.hasMarkedText;
    if (!waits)
        [self send:BDMouseDown event:event];
    [self.inputContext handleEvent:event];
    if (waits)
        [self send:BDMouseDown event:event];
}

- (void)rightMouseDown:(NSEvent*)event { [self send:BDMouseDown event:event]; }
- (void)otherMouseDown:(NSEvent*)event { [self send:BDMouseDown event:event]; }
- (void)mouseUp:(NSEvent*)event { [self send:BDMouseUp event:event]; }
- (void)rightMouseUp:(NSEvent*)event { [self send:BDMouseUp event:event]; }
- (void)otherMouseUp:(NSEvent*)event { [self send:BDMouseUp event:event]; }
- (void)mouseDragged:(NSEvent*)event { [self send:BDMouseMove event:event]; }
- (void)rightMouseDragged:(NSEvent*)event { [self send:BDMouseMove event:event]; }
- (void)otherMouseDragged:(NSEvent*)event { [self send:BDMouseMove event:event]; }
- (void)scrollWheel:(NSEvent*)event
{
    bd_trace("scroll event", NSProcessInfo.processInfo.systemUptime - event.timestamp);
    [self send:BDScroll event:event];
    if (event.hasPreciseScrollingDeltas)
        [clock scrolls];
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
        [self emit:@"swipe" value:event.deltaX > 0 ? @"left" : event.deltaX < 0 ? @"right" : event.deltaY > 0 ? @"up" : @"down"];
}

- (void)resetCursorRects { [self addCursorRect:self.bounds cursor:cursor]; }

- (void)setCursor:(uint8_t)index
{
    if (cursor == cursorAt(index))
        return;
    cursor = cursorAt(index);
    [owned invalidateCursorRectsForView:self];
    if (hasMouse)
        [cursor set];
}

- (void)send:(BDInputKind)kind drag:(id<NSDraggingInfo>)drag
{
    BDInput input = [self input:kind at:drag.draggingLocation];
    NSString* paths;
    if (kind == BDDragEnter) {
        NSArray* files = [drag.draggingPasteboard readObjectsForClasses:@[ NSURL.class ] options:@{ NSPasteboardURLReadingFileURLsOnlyKey : @YES }];
        paths = [[NSString alloc] initWithData:serialize([files valueForKey:@"path"] ?: @[]) encoding:NSUTF8StringEncoding];
    }
    if (!isClosing)
        bd_input(_number, &input, paths.UTF8String);
}

- (NSDragOperation)draggingEntered:(id<NSDraggingInfo>)drag { return [self send:BDDragEnter drag:drag], NSDragOperationCopy; }
- (NSDragOperation)draggingUpdated:(id<NSDraggingInfo>)drag { return [self send:BDDragOver drag:drag], NSDragOperationCopy; }
- (void)draggingExited:(id<NSDraggingInfo>)drag { [self send:BDDragLeave drag:drag]; }
- (void)draggingEnded:(id<NSDraggingInfo>)drag { [self send:BDDragLeave drag:drag]; }
- (BOOL)performDragOperation:(id<NSDraggingInfo>)drag { return [self send:BDDrop drag:drag], YES; }

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
    return bd_key(true);
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
            bd_text_insert(_number, toRange(NSMakeRange(NSNotFound, 0)), typed.UTF8String);
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
        bd_raw_key(flags & masks[event.keyCode - 0x36][!(flags & 0x207F)], false, event.keyCode, 0, modifiersOf(event));
}

- (NSTextInputContext*)inputContext { return bd_text_is_enabled(_number) ? super.inputContext : nil; }

- (void)textInputChanged
{
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
    BDBytes bytes = bd_text(_number, &range);
    NSString* string = [NSString stringWithCharacters:(unichar*)bytes.start length:bytes.length / 2];
    bun_desktop_free(bytes);
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

- (BunDesktopTree*)examinedTree
{
    if (!!tree != hasAssistiveTechnology()) {
        tree = tree ? nil : [[BunDesktopTree alloc] initWithView:self];
        [self report:tree ? BDIsExamined : BDIsNotExamined];
    }
    return tree;
}

- (void)setTree:(NSDictionary*)update { [tree update:update]; }
- (BOOL)isAccessibilityElement { return YES; }
- (NSAccessibilityRole)accessibilityRole { return NSAccessibilityGroupRole; }
- (NSArray*)accessibilityChildren { return self.examinedTree.roots ?: @[]; }
- (id)accessibilityFocusedUIElement { return self.examinedTree.focus ?: self; }
- (id)accessibilityHitTest:(NSPoint)point { return [self.examinedTree at:point] ?: self; }

@end

// ───────────────────────────── for Rust ─────────────────────────────

#define view ((__bridge BunDesktopView*)pointer)

void* bd_window_open(const void* json, size_t length)
{
    @autoreleasepool {
        @try {
            return (__bridge_retained void*)[[BunDesktopView alloc] initWithOptions:parse(json, length)];
        } @catch (NSException* exception) {
            bd_log(exception.description.UTF8String);
            return NULL;
        }
    }
}

char* bd_window_command(void* pointer, const char* name, const void* json, size_t length, uint32_t other)
{
    return answer(^id {
        return [view command:@(name) value:parse(json, length) other:views[@(other)].window];
    });
}

typedef enum : uint8_t { Close, Hide, Show, ShowAndFocus, TextInputChanged, StartMove, TitleWasDoubleClicked } Action;

void bd_window_act(void* pointer, Action action)
{
    char* error = answer(^id {
        switch (action) {
        case Close: [view close]; break;
        case Hide: [view setVisible:false focus:false]; break;
        case Show: [view setVisible:true focus:false]; break;
        case ShowAndFocus: [view setVisible:true focus:true]; break;
        case TextInputChanged: [view textInputChanged]; break;
        case StartMove: [view startMove]; break;
        case TitleWasDoubleClicked: [view titleWasDoubleClicked]; break;
        }
        return nil;
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

void bd_window_set_tree(void* pointer, const void* json, size_t length)
{
    free(answer(^id {
        [view setTree:parse(json, length)];
        return nil;
    }));
}

float bd_window_frequency(void* pointer) { return view.frequency; }
bool bd_window_is_active(void* pointer) { return view.window.isKeyWindow; }
bool bd_window_is_visible(void* pointer) { return view.needsFrames; }
void bd_window_request_frame(void* pointer, bool isLeisurely) { [view requestFrame:isLeisurely]; }
void* bd_window_layer(void* pointer) { return (__bridge void*)view.layer; }
void* bd_window_content_view(void* pointer) { return (__bridge void*)view.superview; }
