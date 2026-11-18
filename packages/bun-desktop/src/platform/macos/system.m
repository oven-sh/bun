// What has nothing to do with a window.
#import "bridge.h"
#import <AVFoundation/AVFoundation.h>
#import <Carbon/Carbon.h>
#import <IOKit/ps/IOPowerSources.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>
#import <ServiceManagement/ServiceManagement.h>
#import <UserNotifications/UserNotifications.h>

static void replyWithError(uint32_t number, NSError* error)
{
    if (error)
        reply(number, BDReplyFailed, .failed = textOf(error.localizedDescription));
    else
        reply(number, BDReplyDone);
}

BDThermalState thermalState(void) { return MIN(NSProcessInfo.processInfo.thermalState, BDThermalStateCritical); }

Class classIn(NSString* framework, NSString* name)
{
    [[NSBundle bundleWithPath:[NSString stringWithFormat:@"/System/Library/Frameworks/%@.framework", framework]] load];
    return NSClassFromString(name);
}

uint32_t rgba(NSColor* color)
{
    color = [color colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
    uint32_t (^byte)(CGFloat) = ^(CGFloat channel) {
        return (uint32_t)lround(fmax(0, fmin(channel, 1)) * 255);
    };
    return byte(color.redComponent) << 24 | byte(color.greenComponent) << 16 | byte(color.blueComponent) << 8 | byte(color.alphaComponent);
}

static uint32_t opaque(NSColor* color) { return rgba(color) | 255; }

static uint32_t highlightIn(NSAppearanceName appearance)
{
    __block uint32_t color;
    [[NSAppearance appearanceNamed:appearance] performAsCurrentDrawingAppearance:^{
        color = opaque(NSColor.selectedTextBackgroundColor);
    }];
    return color;
}

BDSystemSettings bd_settings(void)
{
    NSWorkspace* workspace = NSWorkspace.sharedWorkspace;
    return (BDSystemSettings) {
        .accent = { true, opaque(NSColor.controlAccentColor) },
        .highlight = { true, { { highlightIn(NSAppearanceNameAqua), highlightIn(NSAppearanceNameDarkAqua) } } },
        .overlayScrollbars = { true, NSScroller.preferredScrollerStyle == NSScrollerStyleOverlay },
        .moreContrast = workspace.accessibilityDisplayShouldIncreaseContrast,
        .reducedTransparency = workspace.accessibilityDisplayShouldReduceTransparency,
        .invertedColors = workspace.accessibilityDisplayShouldInvertColors,
    };
}

static NSData* toPNG(NSBitmapImageRep* image) { return [image representationUsingType:NSBitmapImageFileTypePNG properties:@{}]; }

// ───────────────────────────── user defaults, on any thread ─────────────────────────────

static id objectOf(const BDPreferenceValue* value)
{
    switch (value->tag) {
    case BDPreferenceValueFlag: return value->flag ? @YES : @NO;
    case BDPreferenceValueNumber: return value->number == (long)value->number ? @((long)value->number) : @(value->number);
    case BDPreferenceValueText: return string(value->text);
    case BDPreferenceValueArray: {
        NSMutableArray* all = [NSMutableArray new];
        forEach(it, value->array) [all addObject:objectOf(it)];
        return all;
    }
    case BDPreferenceValueDictionary: {
        NSMutableDictionary* all = [NSMutableDictionary new];
        forEach(it, value->dictionary) all[string(it->key)] = objectOf(&it->value);
        return all;
    }
    }
}

static BDPreferenceValue valueOf(id object)
{
    if (object == (id)kCFBooleanTrue || object == (id)kCFBooleanFalse)
        return (BDPreferenceValue) { BDPreferenceValueFlag, .flag = [object boolValue] };
    if ([object isKindOfClass:NSNumber.class])
        return (BDPreferenceValue) { BDPreferenceValueNumber, .number = [object doubleValue] };
    if ([object isKindOfClass:NSArray.class]) {
        BDListPreferenceValue all = listOf(PreferenceValue, [object count]);
        forEach(it, all) *it = valueOf(object[it - all.start]);
        return (BDPreferenceValue) { BDPreferenceValueArray, .array = all };
    }
    if ([object isKindOfClass:NSDictionary.class]) {
        NSArray* keys = [object allKeys];
        BDListPreference all = listOf(Preference, keys.count);
        forEach(it, all) *it = (BDPreference) { textOf([keys[it - all.start] description]), valueOf(object[keys[it - all.start]]) };
        return (BDPreferenceValue) { BDPreferenceValueDictionary, .dictionary = all };
    }
    return (BDPreferenceValue) { BDPreferenceValueText, .text = textOf([object description]) };
}

void bd_preference(const BDText* key, BDMaybePreferenceValue* result)
{
    @autoreleasepool {
        id found = [NSUserDefaults.standardUserDefaults objectForKey:string(*key)];
        if (found)
            *result = (BDMaybePreferenceValue) { true, valueOf(found) };
    }
}

char* bd_change_preference(const BDPreferenceCommand* command)
{
    return attempt(^{
        NSUserDefaults* defaults = NSUserDefaults.standardUserDefaults;
        if (command->tag == BDPreferenceCommandRemove)
            [defaults removeObjectForKey:string(command->remove)];
        else if (command->tag == BDPreferenceCommandSet)
            [defaults setObject:objectOf(&command->set.value) forKey:string(command->set.key)];
        else
            [defaults registerDefaults:@{ string(command->setDefault.key) : objectOf(&command->setDefault.value) }];
    });
}

// ───────────────────────────── spelling, secrets and the clipboard ─────────────────────────────

static NSSpellChecker* spellChecker(void)
{
    const char* setting = getenv("BUN_DESKTOP_SPELLING");
    return setting && !strcmp(setting, "0") ? nil : NSSpellChecker.sharedSpellChecker;
}

static void guessSpelling(NSString* word, uint32_t replyNumber)
{
    NSArray* guesses = [spellChecker() guessesForWordRange:NSMakeRange(0, word.length) inString:word language:nil inSpellDocumentWithTag:0];
    reply(replyNumber, BDReplyGuesses, .guesses = textsOf([guesses subarrayWithRange:NSMakeRange(0, MIN(guesses.count, 5))]));
}

static void checkSpelling(BDListu16 units, uint32_t replyNumber)
{
    if (!spellChecker() || !units.length)
        return reply(replyNumber, BDReplyMisspelled);
    NSString* words = [NSString stringWithCharacters:units.start length:units.length];
    [spellChecker() requestCheckingOfString:words range:NSMakeRange(0, words.length) types:NSTextCheckingTypeSpelling options:nil inSpellDocumentWithTag:0
        completionHandler:^(NSInteger sequence, NSArray<NSTextCheckingResult*>* results, NSOrthography* orthography, NSInteger count) {
            BDListu322 found = listOf(u322, results.count);
            found.length = 0;
            for (NSTextCheckingResult* result in results)
                if (result.resultType == NSTextCheckingTypeSpelling)
                    found.start[found.length++] = (BDu322) { { result.range.location, NSMaxRange(result.range) } };
            reply(replyNumber, BDReplyMisspelled, .misspelled = found);
        }];
}

static void readKeychain(NSString* service, NSString* account, uint32_t replyNumber)
{
    NSDictionary* query = @{
        (id)kSecClass : (id)kSecClassGenericPassword,
        (id)kSecAttrService : service,
        (id)kSecAttrAccount : account,
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
        if (password.length)
            reply(replyNumber, BDReplySecret, .secret = bytesOf(password));
        else
            reply(replyNumber, BDReplyNoSecret, .noSecret = { status != errSecItemNotFound });
    });
}

static BDMaybeText textIfAny(NSString* string) { return (BDMaybeText) { string != nil, textOf(string) }; }

void bd_read_clipboard(BDClipboardPart part, BDClipboard* contents)
{
    @autoreleasepool {
        NSPasteboard* board = NSPasteboard.generalPasteboard;
        contents->text = textIfAny([board stringForType:NSPasteboardTypeString]);
        if (part == BDClipboardPartText)
            return;
        NSArray* files = [board readObjectsForClasses:@[ NSURL.class ] options:@{ NSPasteboardURLReadingFileURLsOnlyKey : @YES }];
        contents->html = textIfAny([board stringForType:NSPasteboardTypeHTML]);
        contents->files = textsOf([files valueForKey:@"path"]);
        // With files come their icons.
        if (files.count)
            return;
        NSData* image = [board dataForType:NSPasteboardTypePNG];
        NSData* other = image ? nil : [board dataForType:NSPasteboardTypeTIFF];
        image = other ? toPNG([NSBitmapImageRep imageRepWithData:other]) : image;
        contents->image = (BDMaybeListu8) { image != nil, bytesOf(image) };
    }
}

static void writeClipboard(const BDClipboard* contents)
{
    NSPasteboard* board = NSPasteboard.generalPasteboard;
    NSString* text = contents->text.has ? stringIfAny(contents->text.value) : nil;
    NSString* html = contents->html.has ? stringIfAny(contents->html.value) : nil;
    NSData* image = contents->image.has ? dataIfAny(contents->image.value) : nil;
    [board clearContents];
    if (text)
        [board setString:text forType:NSPasteboardTypeString];
    // Without it, HTML is taken for Latin-1.
    if (html)
        [board setString:[@"<meta charset='utf-8'>" stringByAppendingString:html] forType:NSPasteboardTypeHTML];
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
        BDMaybeu32 chosen = { ![action isEqual:UNNotificationDefaultActionIdentifier], action.intValue };
        emit(BDSystemEventNotification, .notification = { textOf(response.notification.request.identifier), chosen });
    }
    done();
}

@end

/// It throws for a process without a bundle.
static UNUserNotificationCenter* notificationCenter(void)
{
    return NSBundle.mainBundle.bundleIdentifier ? UNUserNotificationCenter.currentNotificationCenter : nil;
}

static void notify(NSString* tag, NSString* title, NSString* body, NSArray<NSString*>* labels)
{
    static BunDesktopNotifications* delegate;
    static NSMutableDictionary<NSString*, UNNotificationCategory*>* categories;
    UNUserNotificationCenter* center = notificationCenter();
    // Not before it is needed: a native addon may have one of its own.
    if (!delegate)
        center.delegate = delegate = [BunDesktopNotifications new];
    UNMutableNotificationContent* content = [UNMutableNotificationContent new];
    content.title = title;
    content.body = body;
    if (labels.count) {
        NSMutableArray* actions = [NSMutableArray new];
        for (NSString* label in labels) {
            NSString* index = @(actions.count).stringValue;
            [actions addObject:[UNNotificationAction actionWithIdentifier:index title:label options:UNNotificationActionOptionForeground]];
        }
        NSString* name = content.categoryIdentifier = [labels componentsJoinedByString:@"\n"];
        categories = categories ?: [NSMutableDictionary new];
        categories[name] = [UNNotificationCategory categoryWithIdentifier:name actions:actions intentIdentifiers:@[] options:0];
        [center setNotificationCategories:[NSSet setWithArray:categories.allValues]];
    }
    UNNotificationRequest* request = [UNNotificationRequest requestWithIdentifier:tag content:content trigger:nil];
    [center requestAuthorizationWithOptions:UNAuthorizationOptionAlert | UNAuthorizationOptionSound
                          completionHandler:^(BOOL isGranted, NSError* error) {
                              if (isGranted)
                                  [center addNotificationRequest:request withCompletionHandler:nil];
                          }];
}

// ───────────────────────────── hot keys ─────────────────────────────

static NSMutableDictionary<NSNumber*, NSValue*>* hotKeys;
static NSMutableDictionary<NSNumber*, id>* activities;

static OSStatus hotKeyWasPressed(EventHandlerCallRef handler, EventRef event, void* context)
{
    EventHotKeyID key = {};
    GetEventParameter(event, kEventParamDirectObject, typeEventHotKeyID, NULL, sizeof key, NULL, &key);
    if (key.signature != 'BunD')
        return eventNotHandledErr;
    emit(BDSystemEventHotKey, .hotKey = key.id);
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

static void registerHotKey(uint32_t identifier, const BDChord* chord)
{
    if (!hotKeys) {
        hotKeys = [NSMutableDictionary new];
        EventTypeSpec pressed = { kEventClassKeyboard, kEventHotKeyPressed };
        InstallEventHandler(GetApplicationEventTarget(), hotKeyWasPressed, 1, &pressed, NULL, NULL);
    }
    NSUInteger code = keyCode(string(chord->key));
    int bits = chord->modifiers;
    UInt32 modifiers = (bits & 1 ? shiftKey : 0) | (bits & 2 ? controlKey : 0) | (bits & 4 ? optionKey : 0) | (bits & 8 ? cmdKey : 0);
    EventHotKeyRef key;
    if (code == NSNotFound || RegisterEventHotKey(code, modifiers, (EventHotKeyID) { 'BunD', identifier }, GetApplicationEventTarget(), 0, &key))
        fail(@"the shortcut cannot be registered");
    hotKeys[@(identifier)] = [NSValue valueWithPointer:key];
}

static void unregisterHotKey(NSNumber* identifier)
{
    if (hotKeys[identifier])
        UnregisterEventHotKey(hotKeys[identifier].pointerValue);
    hotKeys[identifier] = nil;
}

static void allowSleep(NSNumber* identifier)
{
    if (activities[identifier])
        [NSProcessInfo.processInfo endActivity:activities[identifier]];
    activities[identifier] = nil;
}

void releaseSystem(void)
{
    for (NSNumber* identifier in hotKeys.allKeys)
        unregisterHotKey(identifier);
    for (NSNumber* identifier in activities.allKeys)
        allowSleep(identifier);
}

// ───────────────────────────── permissions, pushes and activities ─────────────────────────────

static NSString* mediaType(BDMedia media) { return media == BDMediaCamera ? @"vide" : @"soun"; }

BDMaybeu32 bd_answer(const BDQuestion* question)
{
    @autoreleasepool {
        if (question->tag == BDQuestionCanAuthenticate) {
            LAContext* context = [classIn(@"LocalAuthentication", @"LAContext") new];
            bool can = [context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:nil];
            return (BDMaybeu32) { true, can && context.biometryType == LABiometryTypeTouchID };
        }
        if (question->tag == BDQuestionAccess) {
            if (question->access == BDMediaScreen)
                return (BDMaybeu32) { true, CGPreflightScreenCaptureAccess() ? AVAuthorizationStatusAuthorized : AVAuthorizationStatusDenied };
            return (BDMaybeu32) { true, [classIn(@"AVFoundation", @"AVCaptureDevice") authorizationStatusForMediaType:mediaType(question->access)] };
        }
        __block BDMaybeu32 color = {};
        NSString* name = string(question->color);
        if ([NSColor respondsToSelector:NSSelectorFromString(name)])
            [NSApp.effectiveAppearance ?: NSAppearance.currentDrawingAppearance performAsCurrentDrawingAppearance:^{
                color = (BDMaybeu32) { true, rgba([NSColor valueForKey:name]) };
            }];
        return color;
    }
}

char* bd_run_as_root(const BDText* prompt, const BDListListText* commands, BDText* said)
{
    return attempt(^{
        AuthorizationItem right = { kAuthorizationRightExecute }, hint = { kAuthorizationEnvironmentPrompt, prompt->bytes.length, prompt->bytes.start };
        AuthorizationRights rights = { 1, &right }, hints = { 1, &hint };
        AuthorizationRef authorization;
        OSStatus status = AuthorizationCreate(&rights, &hints, kAuthorizationFlagInteractionAllowed | kAuthorizationFlagExtendRights, &authorization);
        if (status)
            fail(status == errAuthorizationCanceled ? @"cancelled" : @"refused");
        NSData* output;
        forEach(command, *commands) {
            char* arguments[command->length + 1];
            forEach(it, *command) arguments[it - command->start] = (char*)string(*it).UTF8String;
            arguments[command->length] = NULL;
            FILE* pipe;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
            status = AuthorizationExecuteWithPrivileges(authorization, arguments[0], kAuthorizationFlagDefaults, arguments + 1, &pipe);
#pragma clang diagnostic pop
            if (status)
                break;
            output = [[[NSFileHandle alloc] initWithFileDescriptor:fileno(pipe)] readDataToEndOfFileAndReturnError:nil];
            fclose(pipe);
        }
        AuthorizationFree(authorization, kAuthorizationFlagDestroyRights);
        if (status)
            fail(@"refused");
        *said = (BDText) { bytesOf(output) };
    });
}

static void authenticate(NSString* reason, uint32_t replyNumber)
{
    LAContext* context = [classIn(@"LocalAuthentication", @"LAContext") new];
    [context evaluatePolicy:LAPolicyDeviceOwnerAuthentication localizedReason:reason reply:^(BOOL success, NSError* error) {
        (void)context;
        if (success)
            reply(replyNumber, BDReplyDone);
        else
            reply(replyNumber, BDReplyFailed, .failed = textOf(error.localizedDescription));
    }];
}

static bool isAlwaysSecure;

void updateSecureInput(void)
{
    static bool isSecure;
    BunDesktopView* view = (id)NSApp.keyWindow.delegate;
    bool hasSecret = [view isKindOfClass:BunDesktopView.class] && bd_text_is_secret(view.number);
    if (isSecure == (NSApp.isActive && (isAlwaysSecure || hasSecret)))
        return;
    if ((isSecure = !isSecure))
        EnableSecureEventInput();
    else
        DisableSecureEventInput();
}

static NSMutableArray<NSNumber*>* waitingForToken;
static NSUserActivity* currentActivity;

static void tellWaitingForToken(NSString* token, NSError* error)
{
    for (NSNumber* number in waitingForToken)
        if (token)
            reply(number.unsignedIntValue, BDReplyToken, .token = textOf(token));
        else
            replyWithError(number.unsignedIntValue, error);
    waitingForToken = nil;
}

static void report(BDActivityStep step, NSString* kind, NSDictionary* info, NSString* detail)
{
    emit(BDSystemEventActivity, .activity = { step, textOf(kind), valueOf(info ?: @{}), textOf(detail) });
}

@implementation BunDesktopDelegate (System)

- (void)application:(NSApplication*)application didRegisterForRemoteNotificationsWithDeviceToken:(NSData*)token
{
    NSMutableString* text = [NSMutableString new];
    for (NSUInteger at = 0; at < token.length; at++)
        [text appendFormat:@"%02x", ((const uint8_t*)token.bytes)[at]];
    tellWaitingForToken(text, nil);
}

- (void)application:(NSApplication*)application didFailToRegisterForRemoteNotificationsWithError:(NSError*)error { tellWaitingForToken(nil, error); }

- (void)application:(NSApplication*)application didReceiveRemoteNotification:(NSDictionary*)info
{
    emit(BDSystemEventPushed, .pushed = valueOf(info));
}

- (BOOL)application:(NSApplication*)application willContinueUserActivityWithType:(NSString*)kind
{
    report(BDActivityStepWillContinue, kind, nil, nil);
    return YES;
}

- (BOOL)application:(NSApplication*)application
    continueUserActivity:(NSUserActivity*)activity
      restorationHandler:(void (^)(NSArray<id<NSUserActivityRestoring>>*))restore
{
    report(BDActivityStepContinue, activity.activityType, activity.userInfo, activity.webpageURL.absoluteString);
    return YES;
}

- (void)application:(NSApplication*)application didFailToContinueUserActivityWithType:(NSString*)kind error:(NSError*)error
{
    report(BDActivityStepFailed, kind, nil, error.localizedDescription);
}

- (void)userActivityWillSave:(NSUserActivity*)activity { report(BDActivityStepWillSave, activity.activityType, activity.userInfo, nil); }
- (void)userActivityWasContinued:(NSUserActivity*)activity { report(BDActivityStepWasContinued, activity.activityType, activity.userInfo, nil); }

@end

static void beginActivity(NSString* kind, NSDictionary* info, NSString* url)
{
    currentActivity = [[NSUserActivity alloc] initWithActivityType:kind];
    currentActivity.userInfo = info;
    currentActivity.webpageURL = url ? [NSURL URLWithString:url] : nil;
    currentActivity.delegate = (BunDesktopDelegate*)NSApp.delegate;
    [currentActivity becomeCurrent];
    currentActivity.needsSave = YES;
}

static void showProgress(float done)
{
    NSDockTile* tile = NSApp.dockTile;
    NSImage* icon = NSApp.applicationIconImage;
    tile.contentView = done < 0 ? nil : [NSImageView imageViewWithImage:[NSImage imageWithSize:tile.size flipped:NO drawingHandler:^(NSRect all) {
        [icon drawInRect:all];
        NSRect bar = NSMakeRect(8, 4, all.size.width - 16, 16);
        [[NSColor colorWithWhite:0.2 alpha:0.8] set];
        [[NSBezierPath bezierPathWithRoundedRect:bar xRadius:8 yRadius:8] fill];
        bar = NSInsetRect(bar, 2, 2);
        bar.size.width *= fmin(done, 1);
        [NSColor.whiteColor set];
        [[NSBezierPath bezierPathWithRoundedRect:bar xRadius:6 yRadius:6] fill];
        return YES;
    }]];
    [tile display];
}

// ───────────────────────────── commands ─────────────────────────────

static void registerScheme(NSString* scheme, uint32_t replyNumber)
{
    NSBundle* bundle = NSBundle.mainBundle;
    if (!bundle.bundleIdentifier)
        fail(@"only an app bundle can open URLs");
    LSRegisterURL((__bridge CFURLRef)bundle.bundleURL, false);
    [NSWorkspace.sharedWorkspace setDefaultApplicationAtURL:bundle.bundleURL toOpenURLsWithScheme:scheme completionHandler:^(NSError* error) {
        replyWithError(replyNumber, error);
    }];
}

static NSURL* fileAt(BDText path) { return [NSURL fileURLWithPath:string(path)]; }

static void open_(NSURL* url)
{
    if (!url)
        fail(@"Invalid URL");
    [NSWorkspace.sharedWorkspace openURL:url configuration:NSWorkspaceOpenConfiguration.configuration completionHandler:nil];
}

static NSNotificationCenter* centerOf(BDNotificationCenter which)
{
    return which == BDNotificationCenterWorkspace  ? NSWorkspace.sharedWorkspace.notificationCenter
        : which == BDNotificationCenterDistributed ? NSDistributedNotificationCenter.defaultCenter
                                                   : NSNotificationCenter.defaultCenter;
}

static void observe(BDNotificationCenter which, NSString* name)
{
    [centerOf(which) addObserverForName:name object:nil queue:nil usingBlock:^(NSNotification* it) {
        NSString* object = [it.object isKindOfClass:NSString.class] ? it.object : nil;
        emit(BDSystemEventObserved, .observed = { textOf(it.name), textOf(object), valueOf(it.userInfo ?: @{}) });
    }];
}

static void post(BDNotificationCenter which, NSString* name, NSString* object, NSDictionary* info, bool isUrgent)
{
    if (which == BDNotificationCenterDistributed)
        [NSDistributedNotificationCenter.defaultCenter postNotificationName:name object:object userInfo:info deliverImmediately:isUrgent];
    else
        [centerOf(which) postNotificationName:name object:object userInfo:info];
}

static void sendAction(NSString* selector)
{
    whenIdle(^{
        [NSApp sendAction:NSSelectorFromString(selector) to:nil from:nil];
    });
}

static void openAtLogin(bool isOn)
{
    NSError* error;
    SMAppService* service = SMAppService.mainAppService;
    if (!(isOn ? [service registerAndReturnError:&error] : [service unregisterAndReturnError:&error]) && error)
        fail(error.localizedDescription);
}

static void execute(const BDSystemCommand* command)
{
    switch (command->tag) {
    case BDSystemCommandIdentity:
    case BDSystemCommandActivationToken: break;
    case BDSystemCommandActivate:
        [NSApp unhideWithoutActivation];
        [NSApp activateIgnoringOtherApps:command->activate.stealsFocus];
        break;
    case BDSystemCommandHide: [NSApp hide:nil]; break;
    case BDSystemCommandHideOthers: [NSApp hideOtherApplications:nil]; break;
    case BDSystemCommandUnhide: [NSApp unhideAllApplications:nil]; break;
    case BDSystemCommandShowInDock:
        NSApp.activationPolicy = command->showInDock ? NSApplicationActivationPolicyRegular : NSApplicationActivationPolicyAccessory;
        break;
    case BDSystemCommandBadge: NSApp.dockTile.badgeLabel = stringIfAny(command->badge.text); break;
    case BDSystemCommandProgress: showProgress(command->progress.done); break;
    case BDSystemCommandDockIcon: NSApp.applicationIconImage = imageOf(command->dockIcon); break;
    case BDSystemCommandBeginActivity:
        beginActivity(string(command->beginActivity.kind), objectOf(&command->beginActivity.info), stringIfAny(command->beginActivity.url));
        break;
    case BDSystemCommandUpdateActivity:
        [currentActivity addUserInfoEntriesFromDictionary:objectOf(&command->updateActivity)];
        break;
    case BDSystemCommandResignActivity: [currentActivity resignCurrent]; break;
    case BDSystemCommandInvalidateActivity:
        [currentActivity invalidate];
        currentActivity = nil;
        break;
    case BDSystemCommandUnregisterForPush: [NSApp unregisterForRemoteNotifications]; break;
    case BDSystemCommandSecureInput:
        isAlwaysSecure = command->secureInput;
        updateSecureInput();
        break;
    case BDSystemCommandTouchBarItem: updateTouchBarItem(&command->touchBarItem); break;
    case BDSystemCommandPost:
        post(command->post.center, string(command->post.name), stringIfAny(command->post.object), objectOf(&command->post.info), command->post.isUrgent);
        break;
    case BDSystemCommandCancelBounce: [NSApp cancelUserAttentionRequest:command->cancelBounce]; break;
    case BDSystemCommandCancelQuit: cancelQuit(); break;
    case BDSystemCommandAddRecentDocument: [NSDocumentController.sharedDocumentController noteNewRecentDocumentURL:fileAt(command->addRecentDocument)]; break;
    case BDSystemCommandOpenUrl: open_([NSURL URLWithString:string(command->openUrl)]); break;
    case BDSystemCommandOpenPath: open_(fileAt(command->openPath)); break;
    case BDSystemCommandRevealPath: [NSWorkspace.sharedWorkspace activateFileViewerSelectingURLs:@[ fileAt(command->revealPath) ]]; break;
    case BDSystemCommandOpenAtLogin: openAtLogin(command->openAtLogin); break;
    case BDSystemCommandNotify:
        notify(string(command->notify.tag), string(command->notify.title), string(command->notify.body), strings(command->notify.actions));
        break;
    case BDSystemCommandDismissNotification:
        [notificationCenter() removePendingNotificationRequestsWithIdentifiers:@[ string(command->dismissNotification) ]];
        [notificationCenter() removeDeliveredNotificationsWithIdentifiers:@[ string(command->dismissNotification) ]];
        break;
    case BDSystemCommandObserve: observe(command->observe.center, string(command->observe.name)); break;
    case BDSystemCommandSendAction: sendAction(string(command->sendAction)); break;
    case BDSystemCommandWriteClipboard:
        if (!command->writeClipboard.isSelection)
            writeClipboard(&command->writeClipboard.contents);
        break;
    case BDSystemCommandPreventSleep:
        activities = activities ?: [NSMutableDictionary new];
        activities[@(command->preventSleep.id)] =
            [NSProcessInfo.processInfo beginActivityWithOptions:NSActivityUserInitiated reason:stringIfAny(command->preventSleep.reason) ?: @"-"];
        break;
    case BDSystemCommandAllowSleep: allowSleep(@(command->allowSleep)); break;
    case BDSystemCommandRegisterHotKey: registerHotKey(command->registerHotKey.id, &command->registerHotKey.chord); break;
    case BDSystemCommandUnregisterHotKey: unregisterHotKey(@(command->unregisterHotKey)); break;
    case BDSystemCommandCloseMessageBox: closeMessage(command->closeMessageBox); break;
    case BDSystemCommandApplicationMenu:
    case BDSystemCommandDockMenu:
    case BDSystemCommandClosePopUpMenu:
    case BDSystemCommandTray: menuCommand(command); break;
    }
}

static void trash(NSURL* item, uint32_t replyNumber)
{
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        NSError* error;
        [NSFileManager.defaultManager trashItemAtURL:item resultingItemURL:nil error:&error];
        replyWithError(replyNumber, error);
    });
}

static void begin(const BDSystemRequest* request, uint32_t replyNumber)
{
    switch (request->tag) {
    case BDSystemRequestPickFiles: return pickFiles(&request->pickFiles, replyNumber), cancelQuit();
    case BDSystemRequestMessageBox: return showMessage(&request->messageBox, replyNumber), cancelQuit();
    case BDSystemRequestPopUpMenu:
    case BDSystemRequestPopUpTrayMenu: return popUpMenu(request, replyNumber);
    case BDSystemRequestTrash: return trash(fileAt(request->trash), replyNumber);
    case BDSystemRequestRegisterUrlScheme: return registerScheme(string(request->registerUrlScheme), replyNumber);
    case BDSystemRequestChromiumPassword: fail(@"there is no Secret Service");
    case BDSystemRequestReadKeychain: return readKeychain(string(request->readKeychain.service), string(request->readKeychain.account), replyNumber);
    case BDSystemRequestCheckSpelling: return checkSpelling(request->checkSpelling, replyNumber);
    case BDSystemRequestGuessSpelling: return guessSpelling(string(request->guessSpelling), replyNumber);
    case BDSystemRequestPrint: return print(&request->print, replyNumber), cancelQuit();
    case BDSystemRequestLearnSpelling:
        [spellChecker() learnWord:string(request->learnSpelling)];
        return reply(replyNumber, BDReplyDone);
    case BDSystemRequestAuthenticate: return authenticate(string(request->authenticate), replyNumber);
    case BDSystemRequestAskForAccess:
        return [classIn(@"AVFoundation", @"AVCaptureDevice") requestAccessForMediaType:mediaType(request->askForAccess) completionHandler:^(BOOL isGranted) {
            reply(replyNumber, BDReplyAgreed, .agreed = isGranted);
        }];
    case BDSystemRequestTrustCertificate: return trustCertificate(request, replyNumber), cancelQuit();
    case BDSystemRequestRegisterForPush:
        waitingForToken = waitingForToken ?: [NSMutableArray new];
        [waitingForToken addObject:@(replyNumber)];
        return [NSApp registerForRemoteNotifications];
    }
}

// ───────────────────────────── for Rust ─────────────────────────────

char* bd_command(const BDSystemCommand* command)
{
    return attempt(^{
        execute(command);
    });
}

char* bd_request(uint32_t replyNumber, const BDSystemRequest* request)
{
    return attempt(^{
        begin(request, replyNumber);
    });
}

BDSystemState bd_state(void)
{
    return (BDSystemState) {
        .thermalState = thermalState(),
        .savesPower = NSProcessInfo.processInfo.isLowPowerModeEnabled,
        .reducesMotion = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion,
    };
}

BDPoint bd_cursor_position(void) { return (BDPoint) { NSEvent.mouseLocation.x, primaryHeight() - NSEvent.mouseLocation.y }; }
double bd_idle_seconds(void) { return CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateCombinedSessionState, kCGAnyInputEventType); }
bool bd_is_on_battery(void) { return IOPSGetTimeRemainingEstimate() != kIOPSTimeRemainingUnlimited; }
bool bd_is_hidden(void) { return NSApp.isHidden; }
bool bd_opens_at_login(void) { return SMAppService.mainAppService.status == SMAppServiceStatusEnabled; }

bool bd_is_trusted_for_accessibility(bool prompts)
{
    return AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef) @{ (__bridge id)kAXTrustedCheckOptionPrompt : prompts ? @YES : @NO });
}

int32_t bd_bounce(bool isCritical)
{
    return NSApp.isActive ? -1 : [NSApp requestUserAttention:isCritical ? NSCriticalRequest : NSInformationalRequest];
}

static NSString* stringAt(const void* start, size_t length) { return string((BDText) { { (void*)start, length } }); }

void bd_application_for(const void* address, size_t length, BDMaybeApplication* result)
{
    @autoreleasepool {
        NSURL* url = [NSURL URLWithString:stringAt(address, length)];
        NSURL* found = url ? [NSWorkspace.sharedWorkspace URLForApplicationToOpenURL:url] : nil;
        if (found.path)
            *result = (BDMaybeApplication) { true,
                { textOf([NSFileManager.defaultManager displayNameAtPath:found.path]), textOf(found.path), textOf([NSBundle bundleWithURL:found].bundleIdentifier) } };
    }
}

BDListu8 bd_named_image(const void* name, size_t length)
{
    @autoreleasepool {
        NSImage* image = [NSImage imageNamed:stringAt(name, length)] ?: [NSImage imageWithSystemSymbolName:stringAt(name, length) accessibilityDescription:nil];
        CGImageRef pixels = [image CGImageForProposedRect:NULL context:nil hints:nil];
        return bytesOf(pixels ? toPNG([[NSBitmapImageRep alloc] initWithCGImage:pixels]) : nil);
    }
}

BDListu8 bd_file_icon(const void* path, size_t length, uint32_t side)
{
    @autoreleasepool {
        NSRect rect = NSMakeRect(0, 0, side, side);
        CGImageRef icon = [[NSWorkspace.sharedWorkspace iconForFile:stringAt(path, length)] CGImageForProposedRect:&rect context:nil hints:nil];
        return bytesOf(icon ? toPNG([[NSBitmapImageRep alloc] initWithCGImage:icon]) : nil);
    }
}
