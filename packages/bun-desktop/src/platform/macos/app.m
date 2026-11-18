// The application and its run loop.
#import "bridge.h"
#import <sys/event.h>
#import <sys/sysctl.h>

char* attempt(void (^body)(void))
{
    @autoreleasepool {
        @try {
            body();
            return NULL;
        } @catch (NSException* exception) {
            return strdup((exception.reason ?: exception.name).UTF8String);
        }
    }
}

void fail(NSString* message)
{
    @throw [NSException exceptionWithName:@"BunDesktop" reason:message userInfo:nil];
}

NSString* stringIfAny(BDText text)
{
    size_t marks = 0, length = text.bytes.length;
    while (length - marks >= 3 && !memcmp(text.bytes.start + marks, "\xEF\xBB\xBF", 3))
        marks += 3;
    NSString* rest = length ? [[NSString alloc] initWithBytes:text.bytes.start + marks length:length - marks encoding:NSUTF8StringEncoding] : nil;
    // It would take the first one for a byte order mark.
    return marks && rest ? [[@"" stringByPaddingToLength:marks / 3 withString:@"\uFEFF" startingAtIndex:0] stringByAppendingString:rest] : rest;
}

NSString* string(BDText text) { return stringIfAny(text) ?: @""; }
NSData* dataIfAny(BDListu8 bytes) { return bytes.length ? [NSData dataWithBytes:bytes.start length:bytes.length] : nil; }

NSArray<NSString*>* strings(BDListText texts)
{
    NSMutableArray* all = [NSMutableArray new];
    forEach(it, texts) [all addObject:string(*it)];
    return all;
}

BDListu8 bytesOf(NSData* data)
{
    BDListu8 bytes = { bd_allocate(data.length, 1), data.length, data.length };
    [data getBytes:bytes.start length:bytes.length];
    return bytes;
}

BDText textOf(NSString* string) { return (BDText) { bytesOf([string dataUsingEncoding:NSUTF8StringEncoding allowLossyConversion:YES]) }; }

BDListText textsOf(NSArray<NSString*>* strings)
{
    BDListText texts = listOf(Text, strings.count);
    forEach(it, texts) *it = textOf(strings[it - texts.start]);
    return texts;
}

CGFloat primaryHeight(void) { return NSScreen.screens.firstObject.frame.size.height; }

// ───────────────────────────── the run loop ─────────────────────────────

/// Timers ignore dates that are much later.
static const CFTimeInterval never = 4e9;
static CFRunLoopSourceRef jobs;
static CFRunLoopTimerRef timer;
static bool isWatchingSource;
static CFAbsoluteTime firesAt = never;
/// `bd_loop_pump` itself is what runs the loop, and not a menu, a drag or a resize.
static bool isInNextEvent;

static void report(BDLoopEvent event)
{
    @autoreleasepool {
        bd_loop_event(event);
    }
}

static void hasJobs(void* context) { report(BDHasJobs); }

static void sourceIsReady(void* context)
{
    isWatchingSource = false;
    report(BDSourceIsReady);
}

static void wasWoken(CFFileDescriptorRef descriptor, CFOptionFlags flags, void* context)
{
    report(BDWasWoken);
    CFFileDescriptorEnableCallBacks(descriptor, kCFFileDescriptorReadCallBack);
}

static void timeIsUp(void* context)
{
    firesAt = never;
    report(BDTimeIsUp);
}

static CFRunLoopSourceRef sourceFor(void (*perform)(void*))
{
    CFRunLoopSourceContext context = { .perform = perform };
    CFRunLoopSourceRef source = CFRunLoopSourceCreate(NULL, 0, &context);
    CFRunLoopAddSource(CFRunLoopGetMain(), source, kCFRunLoopCommonModes);
    return source;
}

static void watch(struct kevent change)
{
    static int watcher = -1;
    if (watcher < 0) {
        watcher = kqueue();
        CFRunLoopSourceRef ready = sourceFor(sourceIsReady), due = sourceFor(timeIsUp);
        NSThread* thread = [[NSThread alloc] initWithBlock:^{
            for (struct kevent event = {}; kevent(watcher, NULL, 0, &event, 1, NULL) >= 0 || errno == EINTR;) {
                CFRunLoopSourceSignal(event.filter == EVFILT_TIMER ? due : ready);
                CFRunLoopWakeUp(CFRunLoopGetMain());
            }
        }];
        thread.qualityOfService = NSQualityOfServiceUserInteractive;
        [thread start];
    }
    kevent(watcher, &change, 1, NULL, 0, NULL);
}

/// Until it is readable. `select` on a kqueue waits for whoever is reading it with the lock of the descriptor table held, which
/// the reader needs to drop a one-shot event: neither returns, nor can the process be killed. Another kqueue only looks at the count.
static void watchSource(int descriptor)
{
    if (!isWatchingSource) {
        isWatchingSource = true;
        watch((struct kevent) { .ident = descriptor, .filter = EVFILT_READ, .flags = EV_ADD | EV_ENABLE | EV_DISPATCH });
    }
}

void bd_loop_init(void)
{
    jobs = sourceFor(hasJobs);
}

/// From any thread.
void bd_loop_wake(void)
{
    CFRunLoopSourceSignal(jobs);
    CFRunLoopWakeUp(CFRunLoopGetMain());
}

void bd_loop_observe(int wakeDescriptor)
{
    if (wakeDescriptor >= 0) {
        CFFileDescriptorRef pipe = CFFileDescriptorCreate(NULL, wakeDescriptor, false, wasWoken, NULL);
        CFRunLoopAddSource(CFRunLoopGetMain(), CFFileDescriptorCreateRunLoopSource(NULL, pipe, 0), kCFRunLoopCommonModes);
        CFFileDescriptorEnableCallBacks(pipe, kCFFileDescriptorReadCallBack);
    }
    timer = CFRunLoopTimerCreateWithHandler(NULL, never, never, 0, 0, ^(CFRunLoopTimerRef unused) {
        timeIsUp(NULL);
    });
    CFRunLoopAddTimer(CFRunLoopGetMain(), timer, kCFRunLoopCommonModes);
    CFRunLoopObserverRef observer = CFRunLoopObserverCreateWithHandler(NULL, kCFRunLoopBeforeWaiting, true, 0,
        ^(CFRunLoopObserverRef unused, CFRunLoopActivity activity) {
            report(BDIsAboutToWait);
        });
    CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
}

/// Both are negative for none.
void bd_loop_arm(int descriptor, double seconds)
{
    if (descriptor >= 0)
        watchSource(descriptor);
    CFAbsoluteTime date = seconds < 0 ? never : CFAbsoluteTimeGetCurrent() + seconds;
    if (fabs(date - firesAt) <= 1e-4)
        return;
    firesAt = date;
    // The system puts off the timer of the run loop to save energy, and a frame cannot wait.
    static bool wasPunctual;
    bool isPunctual = seconds > 0 && seconds < 0.05;
    if (isPunctual || wasPunctual)
        watch((struct kevent) { .filter = EVFILT_TIMER, .flags = isPunctual ? EV_ADD | EV_ONESHOT : EV_DELETE, .fflags = NOTE_USECONDS | NOTE_CRITICAL, .data = ceil(seconds * 1e6) });
    if (!isPunctual || !wasPunctual)
        CFRunLoopTimerSetNextFireDate(timer, isPunctual ? never : date);
    wasPunctual = isPunctual;
}

void bd_loop_run(void) { [NSApp run]; }

void bd_loop_run_once(double seconds)
{
    @autoreleasepool {
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, seconds < 0 ? never : seconds, true);
    }
}

/// The menu bar is tracked from inside of it.
bool bd_loop_is_in_next_event(void)
{
    @autoreleasepool {
        return isInNextEvent && [NSRunLoop.mainRunLoop.currentMode isEqual:NSDefaultRunLoopMode];
    }
}

/// What `-[NSApplication run]` does.
void bd_loop_pump(bool mayBlock)
{
    bool was = isInNextEvent;
    for (int count = 0; count < 64; count++, mayBlock = false) {
        @autoreleasepool {
            isInNextEvent = true;
            NSDate* until = mayBlock ? NSDate.distantFuture : NSDate.distantPast;
            NSEvent* event = [NSApp nextEventMatchingMask:NSEventMaskAny untilDate:until inMode:NSDefaultRunLoopMode dequeue:YES];
            isInNextEvent = false;
            if (!event)
                break;
            @try {
                [NSApp sendEvent:event];
                [NSApp updateWindows];
            } @catch (NSException* exception) {
                [NSApp reportException:exception];
            }
        }
    }
    isInNextEvent = was;
}

/// Only an event makes `nextEventMatchingMask:` return.
void postEmptyEvent(void)
{
    NSEvent* event = [NSEvent otherEventWithType:NSEventTypeApplicationDefined location:NSZeroPoint modifierFlags:0 timestamp:0
                                    windowNumber:0 context:nil subtype:0 data1:0 data2:0];
    [NSApp postEvent:event atStart:YES];
}

void bd_loop_post_empty_event(void) { postEmptyEvent(); }

static NSMutableArray<void (^)(void)>* waiting;

static void runWhatIsWaiting(void* context)
{
    while (waiting.count) {
        @autoreleasepool {
            void (^body)(void) = waiting[0];
            [waiting removeObjectAtIndex:0];
            body();
        }
    }
}

/// Also while a menu or an alert is open, for which the blocks of the run loop may have to wait.
void soon(void (^body)(void))
{
    static CFRunLoopSourceRef source;
    if (!source) {
        CFRunLoopSourceContext context = { .perform = runWhatIsWaiting };
        source = CFRunLoopSourceCreate(NULL, 1, &context);
        CFRunLoopAddSource(CFRunLoopGetMain(), source, kCFRunLoopCommonModes);
        waiting = [NSMutableArray new];
    }
    [waiting addObject:body];
    CFRunLoopSourceSignal(source);
    CFRunLoopWakeUp(CFRunLoopGetMain());
}

void whenIdle(void (^body)(void))
{
    CFRunLoopPerformBlock(CFRunLoopGetMain(), kCFRunLoopDefaultMode, ^{
        bool was = isInNextEvent;
        isInNextEvent = false;
        @autoreleasepool {
            @try {
                body();
            } @catch (NSException* exception) {
                bd_log(exception.description.UTF8String);
            }
        }
        isInNextEvent = was;
    });
    CFRunLoopWakeUp(CFRunLoopGetMain());
}

// ───────────────────────────── the application ─────────────────────────────

static bool isLaunched, isTerminating;
static NSDictionary<NSNumber*, NSData*>* knownDisplays;

size_t bd_displays(BDDisplay* displays, size_t capacity)
{
    @autoreleasepool {
        size_t count = 0;
        CGFloat height = primaryHeight();
        BDRect (^flipped)(NSRect) = ^(NSRect rect) {
            return (BDRect) { rect.origin.x, height - NSMaxY(rect), rect.size.width, rect.size.height };
        };
        for (NSScreen* screen in NSScreen.screens) {
            if (count == capacity)
                break;
            displays[count++] = (BDDisplay) {
                [screen.deviceDescription[@"NSScreenNumber"] unsignedIntValue],
                flipped(screen.frame), flipped(screen.visibleFrame), screen.backingScaleFactor, screen.maximumFramesPerSecond
            };
        }
        return count;
    }
}

static NSDictionary<NSNumber*, NSData*>* describeDisplays(void)
{
    BDDisplay displays[32];
    NSMutableDictionary* all = [NSMutableDictionary new];
    for (size_t index = bd_displays(displays, 32); index--;)
        all[@(displays[index].id)] = [NSData dataWithBytes:displays + index length:sizeof(BDDisplay)];
    return all;
}

/// The event is the start of the process.
void traceLaunch(const char* step)
{
    struct kinfo_proc process;
    size_t size = sizeof process;
    if (!sysctl((int[]) { CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid() }, 4, &process, &size, NULL, 0)) {
        struct timeval start = process.kp_proc.p_starttime;
        bd_trace(step, NSDate.now.timeIntervalSince1970 - start.tv_sec - start.tv_usec / 1e6);
    }
}

void cancelQuit(void)
{
    if (isTerminating) {
        isTerminating = false;
        [NSApp replyToApplicationShouldTerminate:NO];
    }
}

@implementation BunDesktopDelegate

- (void)applicationWillFinishLaunching:(NSNotification*)notification { traceLaunch("will finish launching"); }

- (void)applicationDidFinishLaunching:(NSNotification*)notification
{
    traceLaunch("did finish launching");
    if (!isLaunched) {
        isLaunched = true;
        [NSApp stop:nil];
        postEmptyEvent();
    }
}

/// Quit in the Dock, and logging out, ask JavaScript, which may refuse and otherwise exits the process itself.
- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication*)sender
{
    emit(BDSystemEventQuit);
    NSAppleEventDescriptor* event = NSAppleEventManager.sharedAppleEventManager.currentAppleEvent;
    isTerminating = [event attributeDescriptorForKeyword:kAEQuitReason] || [event paramDescriptorForKeyword:kAEQuitReason];
    return isTerminating ? NSTerminateLater : NSTerminateCancel;
}

- (BOOL)applicationShouldHandleReopen:(NSApplication*)sender hasVisibleWindows:(BOOL)hasVisibleWindows
{
    emit(BDSystemEventActivate, .activate = { hasVisibleWindows });
    return hasVisibleWindows;
}

- (void)application:(NSApplication*)application openURLs:(NSArray<NSURL*>*)urls
{
    emit(BDSystemEventOpenUrls, .openUrls = textsOf([urls valueForKey:@"absoluteString"]));
}

- (void)applicationDidBecomeActive:(NSNotification*)notification
{
    updateSecureInput();
    emit(BDSystemEventBecameActive);
}

- (void)applicationDidResignActive:(NSNotification*)notification
{
    updateSecureInput();
    emit(BDSystemEventResignedActive);
}

- (BOOL)applicationSupportsSecureRestorableState:(NSApplication*)application { return YES; }
- (NSMenu*)applicationDockMenu:(NSApplication*)sender { return dockMenu(); }

- (void)applicationDidChangeScreenParameters:(NSNotification*)notification
{
    NSDictionary *before = knownDisplays, *now = knownDisplays = describeDisplays();
    if (![now isEqual:before])
        displaysChanged();
    for (NSNumber* display in before)
        if (!now[display])
            emit(BDSystemEventDisplayRemoved, .displayRemoved = display.unsignedLongLongValue);
    for (NSNumber* display in now)
        if (![now[display] isEqual:before[display]])
            emit(before[display] ? BDSystemEventDisplayChanged : BDSystemEventDisplayAdded, .displayAdded = display.unsignedLongLongValue);
}

// The text fields of panels respond to the first four before this does.
- (void)cut:(id)sender { chose(sender); }
- (void)copy:(id)sender { chose(sender); }
- (void)paste:(id)sender { chose(sender); }
- (void)selectAll:(id)sender { chose(sender); }
- (void)choseMenuItem:(id)sender { chose(sender); }

@end

static void observe(NSNotificationCenter* center, NSNotificationName name, void (^body)(void))
{
    [center addObserverForName:name object:nil queue:nil usingBlock:^(NSNotification* notification) {
        body();
    }];
}

/// Before native addons ask for it.
void bd_create_application(void)
{
    @autoreleasepool {
        traceLaunch("loaded");
        [NSUserDefaults.standardUserDefaults registerDefaults:@{
            @"ApplePersistence" : @NO, // Windows are not restored.
            @"NSApplicationUpdateCycleEnabled" : @NO, // It holds scroll events back for half a frame.
            @"NSAutoFillHeuristicControllerEnabled" : @NO, // It holds up every key.
            @"NSFullScreenMenuItemEverywhere" : @NO,
            @"NSTreatUnknownArgumentsAsOpen" : @"NO",
        }];
        [BunDesktopApplication sharedApplication];
        traceLaunch("there is an application");
    }
}

/// As `LSUIElement` makes it.
bool bd_is_accessory(void)
{
    return NSRunningApplication.currentApplication.activationPolicy == NSApplicationActivationPolicyAccessory;
}

/// By then, the app has been told what to open.
void bd_finish_launching(void)
{
    @autoreleasepool {
        if (!isLaunched && !NSApp.isRunning)
            return [NSApp run];
        for (int patience = 100; !isLaunched && patience--;) {
            NSDate* soon = [NSDate dateWithTimeIntervalSinceNow:0.01];
            NSEvent* event = [NSApp nextEventMatchingMask:NSEventMaskAny untilDate:soon inMode:NSDefaultRunLoopMode dequeue:YES];
            if (event)
                [NSApp sendEvent:event];
        }
    }
}

void bd_launch(bool isAccessory)
{
    static BunDesktopDelegate* delegate;
    static id activity __attribute__((unused));
    @autoreleasepool {
        BunDesktopApplication.sharedApplication.delegate = delegate = [BunDesktopDelegate new];
        NSWindow.allowsAutomaticWindowTabbing = NO;
        NSApplicationActivationPolicy policy = isAccessory ? NSApplicationActivationPolicyAccessory : NSApplicationActivationPolicyRegular;
        if (NSApp.activationPolicy != policy)
            NSApp.activationPolicy = policy;
        isLaunched = NSRunningApplication.currentApplication.isFinishedLaunching;
        knownDisplays = describeDisplays();
        NSNotificationCenter *own = NSNotificationCenter.defaultCenter, *workspace = NSWorkspace.sharedWorkspace.notificationCenter;
        void (^settingsChanged)(void) = ^{
            emit(BDSystemEventSettings, .settings = bd_settings());
        };
        observe(own, NSPreferredScrollerStyleDidChangeNotification, settingsChanged);
        observe(own, NSSystemColorsDidChangeNotification, settingsChanged);
        observe(workspace, NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification, settingsChanged);
        if ([NSApp isKindOfClass:BunDesktopApplication.class])
            [NSApp watchForScreenReaders];
        observe(workspace, NSWorkspaceWillSleepNotification, ^{
            emit(BDSystemEventSuspend);
        });
        observe(workspace, NSWorkspaceDidWakeNotification, ^{
            emit(BDSystemEventResume);
        });
        observe(own, NSProcessInfoThermalStateDidChangeNotification, ^{
            emit(BDSystemEventThermal, .thermal = thermalState());
        });
        // App Nap would slow down everything that runs behind a covered window.
        traceLaunch("windows can be opened");
        activity = [NSProcessInfo.processInfo beginActivityWithOptions:NSActivityUserInitiatedAllowingIdleSystemSleep reason:@"JavaScript"];
    }
}

bool bd_is_dark(void)
{
    @autoreleasepool {
        NSArray* names = @[ NSAppearanceNameAqua, NSAppearanceNameDarkAqua ];
        return [[NSApp.effectiveAppearance bestMatchFromAppearancesWithNames:names] isEqual:NSAppearanceNameDarkAqua];
    }
}

/// Negative for what the system has.
void bd_set_dark(int isDark)
{
    @autoreleasepool {
        NSApp.appearance = isDark < 0 ? nil : [NSAppearance appearanceNamed:isDark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
    }
}

void bd_shut_down(void)
{
    @autoreleasepool {
        removeTrays();
        releaseSystem();
    }
}

void bd_hide_cursor_until_it_moves(void)
{
    if (isLaunched)
        [NSCursor setHiddenUntilMouseMoves:YES];
}
