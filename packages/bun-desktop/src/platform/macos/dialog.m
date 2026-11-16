#import "bridge.h"

static NSMutableDictionary<NSNumber*, NSAlert*>* alerts;

static NSWindow* parentOf(NSDictionary* options)
{
    NSWindow* window = [BunDesktopView withNumber:options[@"window"]].window;
    return window.isVisible ? window : nil;
}

/// Replies with the chosen paths, or null.
static void pickFiles(NSDictionary* options, uint64_t replyNumber)
{
    NSOpenPanel* open = isTrue(options[@"save"]) ? nil : NSOpenPanel.openPanel;
    NSSavePanel* panel = open ?: NSSavePanel.savePanel;
    open.canChooseFiles = isTrue(options[@"files"]);
    open.canChooseDirectories = isTrue(options[@"directories"]);
    open.allowsMultipleSelection = isTrue(options[@"multiple"]);
    open.resolvesAliases = !isTrue(options[@"keepsAliases"]);
    panel.canCreateDirectories = isTrue(options[@"createDirectories"]);
    panel.showsHiddenFiles = isTrue(options[@"showsHiddenFiles"]);
    panel.treatsFilePackagesAsDirectories = isTrue(options[@"entersPackages"]);
    NSDictionary* texts = @{ @"title" : @"title", @"message" : @"message", @"buttonLabel" : @"prompt", @"fileName" : @"nameFieldStringValue" };
    for (NSString* key in texts)
        if (text(options[key]))
            [panel setValue:options[key] forKey:texts[key]];
    if (text(options[@"directory"]))
        panel.directoryURL = [NSURL fileURLWithPath:options[@"directory"]];
    NSMutableArray* extensions = [NSMutableArray new];
    for (id filter in list(options[@"filters"]))
        [extensions addObjectsFromArray:list(member(filter, @"extensions")) ?: @[]];
    [extensions removeObject:@""];
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    // Its successor does not know every extension.
    if (extensions.count && ![extensions containsObject:@"*"])
        panel.allowedFileTypes = extensions;
#pragma clang diagnostic pop
    void (^done)(NSModalResponse) = ^(NSModalResponse response) {
        NSArray* urls = open ? open.URLs : panel.URL ? @[ panel.URL ] : @[];
        reply(replyNumber, response == NSModalResponseOK ? [urls valueForKey:@"path"] : nil);
    };
    NSWindow* parent = parentOf(options);
    whenIdle(^{
        if (parent)
            [panel beginSheetModalForWindow:parent completionHandler:done];
        else
            [panel beginWithCompletionHandler:done];
    });
}

/// Replies with the index of the button, or null if it went away, and the state of the checkbox.
static void showMessage(NSDictionary* options, uint64_t replyNumber)
{
    NSAlert* alert = [NSAlert new];
    bool isBad = [options[@"type"] isEqual:@"warning"] || [options[@"type"] isEqual:@"error"];
    alert.alertStyle = isBad ? NSAlertStyleCritical : NSAlertStyleInformational;
    alert.messageText = text(options[@"message"]) ?: @"";
    alert.informativeText = text(options[@"detail"]) ?: @"";
    [list(options[@"buttons"]) enumerateObjectsUsingBlock:^(id label, NSUInteger index, BOOL* stop) {
        NSButton* button = [alert addButtonWithTitle:text(label) ?: @"(empty)"];
        button.keyEquivalent = [options[@"defaultId"] isEqual:@(index)] ? @"\r" : [options[@"cancelId"] isEqual:@(index)] ? @"\x1b" : @"";
    }];
    if (text(options[@"checkboxLabel"])) {
        alert.showsSuppressionButton = YES;
        alert.suppressionButton.title = options[@"checkboxLabel"];
        alert.suppressionButton.state = isTrue(options[@"checkboxChecked"]);
    }
    NSNumber* identifier = number(options[@"id"]) ?: @0;
    alerts = alerts ?: [NSMutableDictionary new];
    alerts[identifier] = alert;
    void (^done)(NSModalResponse) = ^(NSModalResponse response) {
        alerts[identifier] = nil;
        bool isChecked = alert.showsSuppressionButton && alert.suppressionButton.state;
        id button = response < NSAlertFirstButtonReturn ? NSNull.null : @(response - NSAlertFirstButtonReturn);
        reply(replyNumber, @[ button, isChecked ? @YES : @NO ]);
    };
    NSWindow* parent = parentOf(options);
    whenIdle(^{
        if (!alerts[identifier])
            done(NSModalResponseAbort);
        else if (parent)
            [alert beginSheetModalForWindow:parent completionHandler:done];
        else
            done([alert runModal]);
    });
}

static void closeMessage(NSNumber* identifier)
{
    NSWindow* window = alerts[identifier].window;
    alerts[identifier] = nil;
    if (window.sheetParent)
        [window.sheetParent endSheet:window returnCode:NSModalResponseAbort];
    else if (window.isVisible) {
        [NSApp stopModalWithCode:NSModalResponseAbort];
        postEmptyEvent();
    }
}

bool dialogCommand(NSString* name, id arguments, uint64_t replyNumber)
{
    if ([name isEqual:@"closeMessageBox"])
        return closeMessage(number(arguments) ?: @0), true;
    if ([name isEqual:@"pickFiles"])
        pickFiles(arguments, replyNumber);
    else if ([name isEqual:@"messageBox"])
        showMessage(arguments, replyNumber);
    else
        return false;
    cancelQuit();
    return true;
}
