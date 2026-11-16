// The application and its run loop.
#define _DARWIN_UNLIMITED_SELECT
#import "bridge.h"
#import <sys/sysctl.h>

id parse(const void* json, size_t length)
{
    NSData* data = [NSData dataWithBytesNoCopy:(void*)json length:length freeWhenDone:NO];
    return [NSJSONSerialization JSONObjectWithData:data options:NSJSONReadingFragmentsAllowed error:nil];
}

NSData* serialize(id value)
{
    return [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingFragmentsAllowed error:nil];
}

char* answer(id (^body)(void))
{
    @autoreleasepool {
        NSData* json;
        @try {
            id value = body();
            if (!value)
                return NULL;
            json = serialize(@{ @"value" : value });
        } @catch (NSException* exception) {
            json = serialize(@{ @"error" : exception.reason ?: exception.name });
        }
        return strndup(json.bytes, json.length);
    }
}

void fail(NSString* message)
{
    @throw [NSException exceptionWithName:@"BunDesktop" reason:message userInfo:nil];
}

void emit(NSDictionary* event)
{
    NSData* json = [NSJSONSerialization isValidJSONObject:event] ? serialize(event) : nil;
    bd_emit(json.bytes, json.length);
}

void emitToApp(NSString* name, id value) { emit(@{ @"t" : @"app", @"e" : name, @"v" : value ?: NSNull.null }); }
void reply(uint64_t number, id value) { emit(@{ @"t" : @"reply", @"id" : @(number), @"value" : value ?: NSNull.null }); }

NSData* takeBlob(id blob)
{
    if (!number(blob))
        return nil;
    BDBytes bytes = bun_desktop_take_blob([blob unsignedIntValue]);
    NSData* data = bytes.length ? [NSData dataWithBytes:bytes.start length:bytes.length] : nil;
    bun_desktop_free(bytes);
    return data;
}

NSNumber* putBlob(NSData* data) { return @(bun_desktop_put_blob(data.bytes, data.length)); }

id member(id object, id key)
{
    if ([object isKindOfClass:NSDictionary.class])
        return object[key];
    NSUInteger index = [number(key) unsignedIntegerValue];
    return index < list(object).count ? object[index] : nil;
}

NSString* text(id value) { return [value isKindOfClass:NSString.class] && [value length] ? value : nil; }
NSArray* list(id value) { return [value isKindOfClass:NSArray.class] ? value : nil; }
NSNumber* number(id value) { return [value isKindOfClass:NSNumber.class] ? value : nil; }
bool isTrue(id value) { return value == (id)kCFBooleanTrue; }
bool isFalse(id value) { return value == (id)kCFBooleanFalse; }

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

/// Until it is readable. A `CFFileDescriptor` goes off when a kqueue has nothing to report.
static void watchSource(int descriptor)
{
    static dispatch_semaphore_t wanted;
    if (!wanted) {
        wanted = dispatch_semaphore_create(0);
        CFRunLoopSourceContext context = { .perform = sourceIsReady };
        CFRunLoopSourceRef ready = CFRunLoopSourceCreate(NULL, 0, &context);
        CFRunLoopAddSource(CFRunLoopGetMain(), ready, kCFRunLoopCommonModes);
        NSThread* thread = [[NSThread alloc] initWithBlock:^{
            uint32_t* set = calloc(descriptor / 32 + 1, 4);
            while (!dispatch_semaphore_wait(wanted, DISPATCH_TIME_FOREVER)) {
                set[descriptor / 32] = 1u << descriptor % 32;
                select(descriptor + 1, (fd_set*)set, NULL, NULL, NULL);
                CFRunLoopSourceSignal(ready);
                CFRunLoopWakeUp(CFRunLoopGetMain());
            }
        }];
        thread.qualityOfService = NSQualityOfServiceUserInteractive;
        [thread start];
    }
    if (!isWatchingSource) {
        isWatchingSource = true;
        dispatch_semaphore_signal(wanted);
    }
}

void bd_loop_init(void)
{
    CFRunLoopSourceContext context = { .perform = hasJobs };
    jobs = CFRunLoopSourceCreate(NULL, 0, &context);
    CFRunLoopAddSource(CFRunLoopGetMain(), jobs, kCFRunLoopCommonModes);
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
        firesAt = never;
        report(BDTimeIsUp);
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
    if (fabs(date - firesAt) > 1e-4)
        CFRunLoopTimerSetNextFireDate(timer, firesAt = date);
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
        all[@(displays[index].identifier)] = [NSData dataWithBytes:displays + index length:sizeof(BDDisplay)];
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
    emitToApp(@"quit", nil);
    NSAppleEventDescriptor* event = NSAppleEventManager.sharedAppleEventManager.currentAppleEvent;
    isTerminating = [event attributeDescriptorForKeyword:kAEQuitReason] || [event paramDescriptorForKeyword:kAEQuitReason];
    return isTerminating ? NSTerminateLater : NSTerminateCancel;
}

- (BOOL)applicationShouldHandleReopen:(NSApplication*)sender hasVisibleWindows:(BOOL)hasVisibleWindows
{
    emitToApp(@"activate", hasVisibleWindows ? @YES : @NO);
    return hasVisibleWindows;
}

- (void)application:(NSApplication*)application openURLs:(NSArray<NSURL*>*)urls
{
    emitToApp(@"open-urls", [urls valueForKey:@"absoluteString"]);
}

- (void)applicationDidBecomeActive:(NSNotification*)notification { emitToApp(@"did-become-active", nil); }
- (void)applicationDidResignActive:(NSNotification*)notification { emitToApp(@"did-resign-active", nil); }
- (BOOL)applicationSupportsSecureRestorableState:(NSApplication*)application { return YES; }
- (NSMenu*)applicationDockMenu:(NSApplication*)sender { return dockMenu(); }

- (void)applicationDidChangeScreenParameters:(NSNotification*)notification
{
    NSDictionary *before = knownDisplays, *now = knownDisplays = describeDisplays();
    for (NSNumber* display in before)
        if (!now[display])
            emitToApp(@"display-removed", display);
    for (NSNumber* display in now)
        if (![now[display] isEqual:before[display]])
            emitToApp(before[display] ? @"display-metrics-changed" : @"display-added", display);
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
            @"NSAutoFillHeuristicControllerEnabled" : @NO, // It holds up every key.
            @"NSFullScreenMenuItemEverywhere" : @NO,
            @"NSTreatUnknownArgumentsAsOpen" : @"NO",
        }];
        [NSApplication sharedApplication];
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
        NSApplication.sharedApplication.delegate = delegate = [BunDesktopDelegate new];
        NSWindow.allowsAutomaticWindowTabbing = NO;
        NSApplicationActivationPolicy policy = isAccessory ? NSApplicationActivationPolicyAccessory : NSApplicationActivationPolicyRegular;
        if (NSApp.activationPolicy != policy)
            NSApp.activationPolicy = policy;
        isLaunched = NSRunningApplication.currentApplication.isFinishedLaunching;
        knownDisplays = describeDisplays();
        NSNotificationCenter *own = NSNotificationCenter.defaultCenter, *workspace = NSWorkspace.sharedWorkspace.notificationCenter;
        void (^settingsChanged)(void) = ^{
            emitToApp(@"system-settings", systemSettings());
        };
        observe(own, NSPreferredScrollerStyleDidChangeNotification, settingsChanged);
        observe(own, NSSystemColorsDidChangeNotification, settingsChanged);
        observe(workspace, NSWorkspaceAccessibilityDisplayOptionsDidChangeNotification, settingsChanged);
        observe(workspace, NSWorkspaceWillSleepNotification, ^{
            emitToApp(@"suspend", nil);
        });
        observe(workspace, NSWorkspaceDidWakeNotification, ^{
            emitToApp(@"resume", nil);
        });
        observe(own, NSProcessInfoThermalStateDidChangeNotification, ^{
            emitToApp(@"thermal-state-change", thermalState());
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

/// All sorts of programs look into windows, without a need for everything that a page has.
bool hasAssistiveTechnology(void)
{
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    bool isEnhanced = [number([NSApp accessibilityAttributeValue:@"AXEnhancedUserInterface"]) boolValue];
#pragma clang diagnostic pop
    NSWorkspace* workspace = NSWorkspace.sharedWorkspace;
    return isEnhanced || workspace.isVoiceOverEnabled || workspace.isSwitchControlEnabled;
}

char* bd_command(const char* command, const void* json, size_t length, uint64_t replyNumber)
{
    return answer(^id {
        NSString* name = @(command);
        id arguments = parse(json, length), result = nil;
        if (!systemCommand(name, arguments, replyNumber, &result) && !menuCommand(name, arguments, replyNumber, &result)
            && !dialogCommand(name, arguments, replyNumber))
            fail([@"unknown command " stringByAppendingString:name]);
        return result;
    });
}
