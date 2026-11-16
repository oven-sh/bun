// What has nothing to do with a window.
#import "bridge.h"
#import <Carbon/Carbon.h>
#import <IOKit/ps/IOPowerSources.h>
#import <Security/Security.h>
#import <ServiceManagement/ServiceManagement.h>
#import <UserNotifications/UserNotifications.h>

static NSNumber* boolean(bool value) { return value ? @YES : @NO; }

static void replyWithError(uint64_t number, NSError* error)
{
    if (!error)
        return reply(number, nil);
    emit(@{ @"t" : @"reply", @"id" : @(number), @"error" : error.localizedDescription });
}

NSString* thermalState(void)
{
    return @[ @"nominal", @"fair", @"serious", @"critical" ][MIN(NSProcessInfo.processInfo.thermalState, 3)];
}

NSDictionary* systemSettings(void)
{
    NSColor* accent = [NSColor.controlAccentColor colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
    uint32_t (^byte)(CGFloat) = ^(CGFloat channel) {
        return (uint32_t)lround(fmax(0, fmin(channel, 1)) * 255);
    };
    NSWorkspace* workspace = NSWorkspace.sharedWorkspace;
    return @{
        @"accent" : @(byte(accent.redComponent) << 24 | byte(accent.greenComponent) << 16 | byte(accent.blueComponent) << 8 | 255),
        @"overlayScrollbars" : boolean(NSScroller.preferredScrollerStyle == NSScrollerStyleOverlay),
        @"moreContrast" : boolean(workspace.accessibilityDisplayShouldIncreaseContrast),
        @"reducedTransparency" : boolean(workspace.accessibilityDisplayShouldReduceTransparency),
        @"invertedColors" : boolean(workspace.accessibilityDisplayShouldInvertColors),
    };
}

static NSData* toPNG(NSBitmapImageRep* image) { return [image representationUsingType:NSBitmapImageFileTypePNG properties:@{}]; }

static bool hasNull(id value)
{
    NSArray* members = [value isKindOfClass:NSDictionary.class] ? [value allValues] : list(value);
    for (id it in members)
        if (hasNull(it))
            return true;
    return !value || value == NSNull.null;
}

/// On any thread.
static id userDefaults(NSString* command, id arguments)
{
    NSUserDefaults* defaults = NSUserDefaults.standardUserDefaults;
    NSString* key = text(member(arguments, @0));
    id value = member(arguments, @1);
    if (!key)
        fail(@"Expected a key");
    if ([command isEqual:@"defaults.get"]) {
        id found = [defaults objectForKey:key];
        return found && [NSJSONSerialization isValidJSONObject:@[ found ]] ? found : nil;
    }
    if ([command isEqual:@"defaults.remove"])
        [defaults removeObjectForKey:key];
    else if (hasNull(value))
        fail(@"A user default cannot be null");
    else if ([command isEqual:@"defaults.register"])
        [defaults registerDefaults:@{ key : value }];
    else
        [defaults setObject:value forKey:key];
    return nil;
}

static void spelling(NSString* command, NSString* words, uint64_t replyNumber)
{
    const char* setting = getenv("BUN_DESKTOP_SPELLING");
    NSSpellChecker* checker = setting && !strcmp(setting, "0") ? nil : NSSpellChecker.sharedSpellChecker;
    NSRange all = NSMakeRange(0, words.length);
    if (!checker || !words.length)
        return reply(replyNumber, @[]);
    if ([command isEqual:@"spelling.learn"]) {
        [checker learnWord:words];
        return reply(replyNumber, nil);
    }
    if ([command isEqual:@"spelling.guess"]) {
        NSArray* guesses = [checker guessesForWordRange:all inString:words language:nil inSpellDocumentWithTag:0] ?: @[];
        return reply(replyNumber, [guesses subarrayWithRange:NSMakeRange(0, MIN(guesses.count, 5))]);
    }
    [checker requestCheckingOfString:words range:all types:NSTextCheckingTypeSpelling options:nil inSpellDocumentWithTag:0
                   completionHandler:^(NSInteger sequence, NSArray<NSTextCheckingResult*>* results, NSOrthography* orthography, NSInteger count) {
                       NSMutableArray* found = [NSMutableArray new];
                       for (NSTextCheckingResult* result in results)
                           if (result.resultType == NSTextCheckingTypeSpelling)
                               [found addObjectsFromArray:@[ @(result.range.location), @(NSMaxRange(result.range)) ]];
                       reply(replyNumber, found);
                   }];
}

/// Replies with a blob, or with whether the system would have to ask the user.
static void readKeychain(NSDictionary* item, uint64_t replyNumber)
{
    NSDictionary* query = @{
        (id)kSecClass : (id)kSecClassGenericPassword,
        (id)kSecAttrService : text(item[@"service"]) ?: @"",
        (id)kSecAttrAccount : text(item[@"name"]) ?: @"",
        (id)kSecReturnData : @YES,
    };
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        CFTypeRef found = NULL;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        SecKeychainSetUserInteractionAllowed(false);
        OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &found);
        SecKeychainSetUserInteractionAllowed(true);
#pragma clang diagnostic pop
        NSData* password = CFBridgingRelease(found);
        reply(replyNumber, password.length ? @{ @"blob" : putBlob(password) } : @{ @"asks" : boolean(status != errSecItemNotFound) });
    });
}

static id readClipboard(bool onlyText)
{
    NSPasteboard* board = NSPasteboard.generalPasteboard;
    NSMutableDictionary* contents = [NSMutableDictionary new];
    contents[@"text"] = [board stringForType:NSPasteboardTypeString];
    if (onlyText)
        return contents;
    NSArray* files = [board readObjectsForClasses:@[ NSURL.class ] options:@{ NSPasteboardURLReadingFileURLsOnlyKey : @YES }];
    contents[@"html"] = [board stringForType:NSPasteboardTypeHTML];
    // With files come their icons.
    if (files.count)
        return contents[@"files"] = [files valueForKey:@"path"], contents;
    NSData* image = [board dataForType:NSPasteboardTypePNG];
    NSData* other = image ? nil : [board dataForType:NSPasteboardTypeTIFF];
    image = other ? toPNG([NSBitmapImageRep imageRepWithData:other]) : image;
    contents[@"image"] = image ? putBlob(image) : nil;
    return contents;
}

static void writeClipboard(NSDictionary* contents)
{
    NSData* image = takeBlob(contents[@"image"]);
    if (isTrue(contents[@"selection"]))
        return;
    NSPasteboard* board = NSPasteboard.generalPasteboard;
    [board clearContents];
    if (text(contents[@"text"]))
        [board setString:contents[@"text"] forType:NSPasteboardTypeString];
    // Without it, HTML is taken for Latin-1.
    if (text(contents[@"html"]))
        [board setString:[@"<meta charset='utf-8'>" stringByAppendingString:contents[@"html"]] forType:NSPasteboardTypeHTML];
    if (image) {
        [board setData:image forType:NSPasteboardTypePNG];
        [board setData:[NSBitmapImageRep imageRepWithData:image].TIFFRepresentation forType:NSPasteboardTypeTIFF];
    }
}

// ───────────────────────────── notifications ─────────────────────────────

@interface BunDesktopNotifications : NSObject <UNUserNotificationCenterDelegate>
@end

@implementation BunDesktopNotifications

- (void)userNotificationCenter:(UNUserNotificationCenter*)center
       willPresentNotification:(UNNotification*)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))done
{
    done(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList);
}

- (void)userNotificationCenter:(UNUserNotificationCenter*)center
    didReceiveNotificationResponse:(UNNotificationResponse*)response
             withCompletionHandler:(void (^)(void))done
{
    NSString* action = response.actionIdentifier;
    if (![action isEqual:UNNotificationDismissActionIdentifier]) {
        id chosen = [action isEqual:UNNotificationDefaultActionIdentifier] ? NSNull.null : action;
        emit(@{ @"t" : @"notification", @"tag" : response.notification.request.identifier, @"action" : chosen });
    }
    done();
}

@end

/// It throws for a process without a bundle.
static UNUserNotificationCenter* notificationCenter(void)
{
    return NSBundle.mainBundle.bundleIdentifier ? UNUserNotificationCenter.currentNotificationCenter : nil;
}

static void notify(NSDictionary* from)
{
    static BunDesktopNotifications* delegate;
    static NSMutableDictionary<NSString*, UNNotificationCategory*>* categories;
    UNUserNotificationCenter* center = notificationCenter();
    // Not before it is needed: a native addon may have one of its own.
    if (!delegate)
        center.delegate = delegate = [BunDesktopNotifications new];
    UNMutableNotificationContent* content = [UNMutableNotificationContent new];
    content.title = text(from[@"title"]) ?: @"";
    content.body = text(from[@"body"]) ?: @"";
    NSArray* labels = list(from[@"actions"]);
    if (labels.count) {
        NSMutableArray* actions = [NSMutableArray new];
        for (id label in labels) {
            NSString* index = @(actions.count).stringValue;
            [actions addObject:[UNNotificationAction actionWithIdentifier:index title:text(label) ?: @"" options:UNNotificationActionOptionForeground]];
        }
        NSString* name = content.categoryIdentifier = [labels componentsJoinedByString:@"\n"];
        categories = categories ?: [NSMutableDictionary new];
        categories[name] = [UNNotificationCategory categoryWithIdentifier:name actions:actions intentIdentifiers:@[] options:0];
        [center setNotificationCategories:[NSSet setWithArray:categories.allValues]];
    }
    UNNotificationRequest* request = [UNNotificationRequest requestWithIdentifier:text(from[@"tag"]) ?: @"-" content:content trigger:nil];
    [center requestAuthorizationWithOptions:UNAuthorizationOptionAlert | UNAuthorizationOptionSound
                          completionHandler:^(BOOL isGranted, NSError* error) {
                              if (isGranted)
                                  [center addNotificationRequest:request withCompletionHandler:nil];
                          }];
}

// ───────────────────────────── hot keys ─────────────────────────────

static NSMutableDictionary<NSString*, NSValue*>* hotKeys;
static NSMutableDictionary<NSNumber*, id>* activities;

static OSStatus hotKeyWasPressed(EventHandlerCallRef handler, EventRef event, void* context)
{
    EventHotKeyID key = {};
    GetEventParameter(event, kEventParamDirectObject, typeEventHotKeyID, NULL, sizeof key, NULL, &key);
    if (key.signature != 'BunD')
        return eventNotHandledErr;
    @autoreleasepool {
        emit(@{ @"t" : @"hotkey", @"id" : @(key.id) });
    }
    return noErr;
}

/// By `kVK_` code.
static NSUInteger keyCode(NSString* name)
{
    NSString* names = @"a s d f h g z x c v § b q w e r y t 1 2 3 4 6 5 = 9 7 - 8 0 ] o u [ i p enter l j ' k ; \\ , / n m . tab space ` "
                       "backspace § escape § § § § § § § § § § f17 numdec § nummult § numadd § § volumeup volumedown volumemute numdiv "
                       "numenter § numsub f18 f19 § num0 num1 num2 num3 num4 num5 num6 num7 f20 num8 num9 § § § f5 f6 f7 f3 f8 f9 § f11 § "
                       "f13 f16 f14 § f10 § f12 § f15 insert home pageup delete f4 end f2 pagedown f1 left right down up";
    return [[names componentsSeparatedByString:@" "] indexOfObject:name];
}

static id setHotKey(NSString* accelerator, bool isOn)
{
    static UInt32 last;
    if (!hotKeys) {
        hotKeys = [NSMutableDictionary new];
        EventTypeSpec pressed = { kEventClassKeyboard, kEventHotKeyPressed };
        InstallEventHandler(GetApplicationEventTarget(), hotKeyWasPressed, 1, &pressed, NULL, NULL);
    }
    if (hotKeys[accelerator])
        UnregisterEventHotKey(hotKeys[accelerator].pointerValue);
    hotKeys[accelerator] = nil;
    if (!isOn)
        return nil;
    NSArray* parts = [accelerator.lowercaseString componentsSeparatedByString:@"+"];
    NSUInteger code = keyCode(parts.lastObject);
    UInt32 modifiers = ([parts containsObject:@"ctrl"] ? controlKey : 0) | ([parts containsObject:@"alt"] ? optionKey : 0)
        | ([parts containsObject:@"shift"] ? shiftKey : 0) | ([parts containsObject:@"super"] ? cmdKey : 0);
    EventHotKeyRef key;
    if (code == NSNotFound || RegisterEventHotKey(code, modifiers, (EventHotKeyID) { 'BunD', ++last }, GetApplicationEventTarget(), 0, &key))
        fail(@"the shortcut cannot be registered");
    hotKeys[accelerator] = [NSValue valueWithPointer:key];
    return @(last);
}

static void allowSleep(NSNumber* identifier)
{
    if (activities[identifier])
        [NSProcessInfo.processInfo endActivity:activities[identifier]];
    activities[identifier] = nil;
}

void releaseSystem(void)
{
    for (NSString* accelerator in hotKeys.allKeys)
        setHotKey(accelerator, false);
    for (NSNumber* identifier in activities.allKeys)
        allowSleep(identifier);
}

// ───────────────────────────── commands ─────────────────────────────

static NSURL* applicationFor(NSString* address)
{
    NSURL* url = address ? [NSURL URLWithString:address] : nil;
    return url ? [NSWorkspace.sharedWorkspace URLForApplicationToOpenURL:url] : nil;
}

static void registerScheme(NSString* scheme, uint64_t replyNumber)
{
    NSBundle* bundle = NSBundle.mainBundle;
    if (!bundle.bundleIdentifier)
        fail(@"only an app bundle can open URLs");
    LSRegisterURL((__bridge CFURLRef)bundle.bundleURL, false);
    [NSWorkspace.sharedWorkspace setDefaultApplicationAtURL:bundle.bundleURL toOpenURLsWithScheme:scheme completionHandler:^(NSError* error) {
        replyWithError(replyNumber, error);
    }];
}

static id bounce(id how)
{
    if (number(how))
        [NSApp cancelUserAttentionRequest:[how integerValue]];
    else if (!NSApp.isActive)
        return @([NSApp requestUserAttention:[how isEqual:@"critical"] ? NSCriticalRequest : NSInformationalRequest]);
    return @-1;
}

bool systemCommand(NSString* name, id arguments, uint64_t replyNumber, id* result)
{
    NSWorkspace* workspace = NSWorkspace.sharedWorkspace;
    NSString* string = text(arguments);
#define is(command) [name isEqual:@command]
#define file [NSURL fileURLWithPath:string]
    if ([name hasPrefix:@"defaults."])
        *result = userDefaults(name, arguments);
    else if (is("keychain.read"))
        readKeychain(arguments, replyNumber);
    else if ([name hasPrefix:@"spelling."])
        spelling(name, string, replyNumber);
    else if (is("info"))
        *result = @{
            @"thermalState" : thermalState(),
            @"lowPower" : boolean(NSProcessInfo.processInfo.isLowPowerModeEnabled),
            @"reduceMotion" : boolean(workspace.accessibilityDisplayShouldReduceMotion),
        };
    else if (is("identity"))
        ;
    else if (is("activate")) {
        [NSApp unhideWithoutActivation];
        [NSApp activateIgnoringOtherApps:isTrue(arguments)];
    } else if (is("hide"))
        [NSApp hide:nil];
    else if (is("hideOthers"))
        [NSApp hideOtherApplications:nil];
    else if (is("unhide"))
        [NSApp unhideAllApplications:nil];
    else if (is("isHidden"))
        *result = boolean(NSApp.isHidden);
    else if (is("activationPolicy"))
        NSApp.activationPolicy = [string isEqual:@"regular"] ? NSApplicationActivationPolicyRegular : NSApplicationActivationPolicyAccessory;
    else if (is("badge"))
        NSApp.dockTile.badgeLabel = text(arguments[@"text"]);
    else if (is("bounce"))
        *result = bounce(arguments);
    else if (is("cancelQuit"))
        cancelQuit();
    else if (is("recentDocument"))
        [NSDocumentController.sharedDocumentController noteNewRecentDocumentURL:file];
    else if (is("openUrl")) {
        NSURL* url = string ? [NSURL URLWithString:string] : nil;
        if (!url)
            fail(@"Invalid URL");
        [workspace openURL:url configuration:NSWorkspaceOpenConfiguration.configuration completionHandler:nil];
    } else if (is("openPath"))
        [workspace openURL:file configuration:NSWorkspaceOpenConfiguration.configuration completionHandler:nil];
    else if (is("revealPath"))
        [workspace activateFileViewerSelectingURLs:@[ file ]];
    else if (is("trash")) {
        NSURL* item = file;
        dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
            NSError* error;
            [NSFileManager.defaultManager trashItemAtURL:item resultingItemURL:nil error:&error];
            replyWithError(replyNumber, error);
        });
    } else if (is("registerUrlScheme"))
        registerScheme(string, replyNumber);
    else if (is("protocolHandler")) {
        NSURL* application = applicationFor([string stringByAppendingString:@"://"]);
        *result = application ? [NSBundle bundleWithURL:application].bundleIdentifier : nil;
    } else if (is("applicationFor")) {
        NSString* path = applicationFor(string).path;
        *result = path ? @{ @"name" : [NSFileManager.defaultManager displayNameAtPath:path], @"path" : path } : nil;
    } else if (is("fileIcon")) {
        NSRect rect = NSMakeRect(0, 0, [arguments[1] doubleValue], [arguments[1] doubleValue]);
        CGImageRef icon = [[workspace iconForFile:arguments[0]] CGImageForProposedRect:&rect context:nil hints:nil];
        NSData* image = icon ? toPNG([[NSBitmapImageRep alloc] initWithCGImage:icon]) : nil;
        *result = image ? putBlob(image) : nil;
    } else if (is("notify"))
        notify(arguments);
    else if (is("dismissNotification")) {
        [notificationCenter() removePendingNotificationRequestsWithIdentifiers:@[ string ]];
        [notificationCenter() removeDeliveredNotificationsWithIdentifiers:@[ string ]];
    } else if (is("observe")) {
        NSNotificationCenter* center = [arguments[0] isEqual:@"workspace"] ? workspace.notificationCenter
            : [arguments[0] isEqual:@"distributed"]                        ? NSDistributedNotificationCenter.defaultCenter
                                                                           : NSNotificationCenter.defaultCenter;
        [center addObserverForName:arguments[1] object:nil queue:nil usingBlock:^(NSNotification* notification) {
            emitToApp(@"notification", notification.name);
        }];
    } else if (is("sendAction"))
        whenIdle(^{
            [NSApp sendAction:NSSelectorFromString(string) to:nil from:nil];
        });
    else if (is("readClipboard"))
        *result = readClipboard([string isEqual:@"text"]);
    else if (is("writeClipboard"))
        writeClipboard(arguments);
    else if (is("systemSettings"))
        *result = systemSettings();
    else if (is("cursor"))
        *result = @{ @"x" : @(NSEvent.mouseLocation.x), @"y" : @(primaryHeight() - NSEvent.mouseLocation.y) };
    else if (is("idleSeconds"))
        *result = @(CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateCombinedSessionState, kCGAnyInputEventType));
    else if (is("onBattery"))
        *result = boolean(IOPSGetTimeRemainingEstimate() != kIOPSTimeRemainingUnlimited);
    else if (is("preventSleep")) {
        activities = activities ?: [NSMutableDictionary new];
        activities[arguments[@"id"]] = [NSProcessInfo.processInfo beginActivityWithOptions:NSActivityUserInitiated reason:text(arguments[@"reason"]) ?: @"-"];
    } else if (is("allowSleep"))
        allowSleep(arguments);
    else if (is("hotkey"))
        *result = setHotKey(arguments[@"accelerator"], isTrue(arguments[@"on"]));
    else if (is("opensAtLogin"))
        *result = boolean(SMAppService.mainAppService.status == SMAppServiceStatusEnabled);
    else if (is("setOpensAtLogin")) {
        NSError* error;
        SMAppService* service = SMAppService.mainAppService;
        if (!(isTrue(arguments[@"on"]) ? [service registerAndReturnError:&error] : [service unregisterAndReturnError:&error]) && error)
            fail(error.localizedDescription);
    } else if (is("isTrustedAccessibilityClient")) {
        NSDictionary* options = @{ (__bridge id)kAXTrustedCheckOptionPrompt : boolean(isTrue(arguments)) };
        *result = boolean(AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options));
    } else
        return false;
    return true;
}
