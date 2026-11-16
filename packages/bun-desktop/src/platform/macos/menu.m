// Menus, and icons in the menu bar.
#import "bridge.h"

static NSEvent* sentKey;
static NSMenu *dock, *popup;
static uint64_t lastPopup, closedPopup;
/// What the items do to windows that are AppKit's own, such as the About panel.
static NSMutableDictionary<NSNumber*, NSString*>* windowActions;

static NSEvent* currentKey(void)
{
    NSEvent* event = NSApp.currentEvent;
    return event.type == NSEventTypeKeyDown ? event : nil;
}

void bd_did_send_key(void) { sentKey = currentKey(); }

void chose(id sender)
{
    NSMenuItem* item = [sender isKindOfClass:NSMenuItem.class] ? sender : nil;
    NSEvent* key = currentKey();
    // The page may have a use for the key. If not, JavaScript finds the item.
    if (!item || (key && key == sentKey))
        return;
    NSWindow* window = NSApp.keyWindow;
    if (window && ![window.delegate isKindOfClass:BunDesktopView.class]) {
        NSString* action = windowActions[@(item.tag)];
        if (action)
            return (void)[NSApp sendAction:NSSelectorFromString(action) to:nil from:item];
        if (item.action != NSSelectorFromString(@"choseMenuItem:"))
            return;
    }
    emit(@{ @"t" : @"menu", @"id" : @(item.tag), @"byKey" : key.modifierFlags & NSEventModifierFlagCommand ? @YES : @NO });
}

NSMenu* dockMenu(void) { return dock; }

static NSString* keyEquivalent(NSString* key)
{
    NSDictionary* named = @{
        @"space" : @0x20, @"tab" : @0x09, @"enter" : @0x0D, @"escape" : @0x1B, @"backspace" : @0x08,
        @"up" : @0xF700, @"down" : @0xF701, @"left" : @0xF702, @"right" : @0xF703, @"insert" : @0xF727,
        @"delete" : @0xF728, @"home" : @0xF729, @"end" : @0xF72B, @"pageup" : @0xF72C, @"pagedown" : @0xF72D, @"menu" : @0xF735,
    };
    int function = [key hasPrefix:@"f"] ? [key substringFromIndex:1].intValue : 0;
    unichar code = function ? 0xF703 + function : [named[key] unsignedShortValue];
    return code ? [NSString stringWithCharacters:&code length:1] : [key isEqual:@"capslock"] ? @"" : key;
}

static NSImage* image(id blob, id size, bool isTemplate)
{
    NSData* data = takeBlob(blob);
    NSImage* image = data ? [[NSImage alloc] initWithData:data] : nil;
    if (number(member(size, @"width")))
        image.size = NSMakeSize([size[@"width"] doubleValue], [size[@"height"] doubleValue]);
    image.template = isTemplate;
    return image;
}

static void update(NSMenuItem* item, NSDictionary* from)
{
    NSString* label = text(from[@"label"]) ?: @"";
    if (![item.title isEqual:label])
        item.title = label;
    item.tag = number(from[@"id"]).integerValue;
    item.enabled = !isFalse(from[@"enabled"]) && ![from[@"type"] isEqual:@"header"];
    item.state = isTrue(from[@"checked"]) ? NSControlStateValueOn : NSControlStateValueOff;
    item.toolTip = text(from[@"toolTip"]);
    if ([item respondsToSelector:NSSelectorFromString(@"setSubtitle:")])
        [item setValue:text(from[@"sublabel"]) forKey:@"subtitle"];
    NSDictionary* actions = @{ @"close" : @"performClose:", @"minimize" : @"performMiniaturize:", @"undo" : @"undo:", @"redo" : @"redo:" };
    windowActions = windowActions ?: [NSMutableDictionary new];
    windowActions[@(item.tag)] = actions[text(from[@"role"]) ?: @""];
}

/// `items` gets one object for each item, depth first, and `special` the menus that AppKit adds to.
static NSMenu* build(NSString* title, id template, NSMutableArray* items, NSMutableDictionary* special)
{
    NSMenu* menu = [[NSMenu alloc] initWithTitle:title];
    menu.autoenablesItems = NO;
    for (NSDictionary* from in list(template)) {
        NSString *label = text(from[@"label"]) ?: @"", *role = text(from[@"role"]) ?: @"";
        if ([from[@"type"] isEqual:@"separator"]) {
            [items addObject:NSNull.null];
            [menu addItem:NSMenuItem.separatorItem];
            continue;
        }
        bool isHeader = [from[@"type"] isEqual:@"header"] && [NSMenuItem respondsToSelector:@selector(sectionHeaderWithTitle:)];
        NSMenuItem* item = isHeader ? [NSMenuItem sectionHeaderWithTitle:label] : [NSMenuItem new];
        [items addObject:item];
        if (isHeader) {
            [menu addItem:item];
            continue;
        }
        update(item, from);
        id icon = from[@"icon"], chord = from[@"accelerator"];
        item.image = image(member(icon, @"blob"), icon, isTrue(member(icon, @"template")));
        if (list(from[@"submenu"]) || [role isEqual:@"services"]) {
            item.submenu = special[role] = build(label, from[@"submenu"], items, special);
        } else {
            bool edits = [@[ @"cut", @"copy", @"paste", @"selectAll" ] containsObject:role];
            item.action = NSSelectorFromString(edits ? [role stringByAppendingString:@":"] : @"choseMenuItem:");
            if (text(member(chord, @0))) {
                int bits = number(member(chord, @1)).intValue;
                item.keyEquivalent = keyEquivalent(chord[0]);
                item.keyEquivalentModifierMask = (bits & 1 ? NSEventModifierFlagShift : 0) | (bits & 2 ? NSEventModifierFlagControl : 0)
                    | (bits & 4 ? NSEventModifierFlagOption : 0) | (bits & 8 ? NSEventModifierFlagCommand : 0);
            }
        }
        [menu addItem:item];
    }
    return menu;
}

static NSMenu* buildAlone(id template) { return build(@"", template, nil, [NSMutableDictionary new]); }

static void forEachItem(id template, void (^body)(NSDictionary*))
{
    for (NSDictionary* item in list(template)) {
        body(item);
        forEachItem(item[@"submenu"], body);
    }
}

static void changeMainMenu(id template)
{
    static NSArray *lastShape, *lastItems;
    NSMutableArray* shape = [NSMutableArray new];
    // What `update` cannot change.
    forEachItem(template, ^(NSDictionary* item) {
        for (NSString* key in @[ @"type", @"role", @"accelerator", @"icon" ])
            [shape addObject:item[key] ?: NSNull.null];
        [shape addObject:list(item[@"submenu"]) ? @[ @([item[@"submenu"] count]), item[@"label"] ?: @"" ] : NSNull.null];
    });
    [windowActions removeAllObjects];
    if (lastItems.count && [shape isEqual:lastShape]) {
        NSEnumerator* each = lastItems.objectEnumerator;
        return forEachItem(template, ^(NSDictionary* from) {
            id item = each.nextObject;
            if (item != NSNull.null)
                update(item, from);
        });
    }
    NSMutableArray* items = [NSMutableArray new];
    NSMutableDictionary* special = [NSMutableDictionary new];
    NSMenu* menu = build(@"", template, items, special);
    lastShape = shape;
    lastItems = items;
    // Not while it is open.
    whenIdle(^{
        NSApp.mainMenu = menu;
        NSApp.servicesMenu = special[@"services"];
        NSApp.windowsMenu = special[@"window"];
        NSApp.helpMenu = special[@"help"];
    });
}

/// Apps replace it many times in a row, and AppKit takes its time over each.
static void changeMainMenuSoon(id template)
{
    static id next;
    id replaced = next;
    next = template;
    if (replaced)
        return forEachItem(replaced, ^(NSDictionary* item) {
            takeBlob(member(item[@"icon"], @"blob"));
        });
    NSTimer* timer = [NSTimer timerWithTimeInterval:0.05 repeats:NO block:^(NSTimer* unused) {
        id last = next;
        next = nil;
        changeMainMenu(last);
    }];
    [NSRunLoop.mainRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
}

/// Replies when it has closed.
static void track(uint64_t replyNumber, NSMenu* menu, void (^show)(void))
{
    lastPopup = replyNumber;
    whenIdle(^{
        @try {
            if (closedPopup < replyNumber) {
                popup = menu;
                show();
            }
        } @finally {
            popup = nil;
            reply(replyNumber, nil);
        }
    });
}

@interface BunDesktopTray : NSResponder
@property NSNumber* number;
@property NSStatusItem* item;
@end

@implementation BunDesktopTray

- (void)emit:(NSString*)event
{
    NSPoint at = NSEvent.mouseLocation;
    emit(@{ @"t" : @"tray", @"id" : _number, @"e" : event, @"x" : @(at.x), @"y" : @(primaryHeight() - at.y) });
}

- (void)clicked:(id)sender
{
    NSEvent* event = NSApp.currentEvent;
    bool isLeft = event.type == NSEventTypeLeftMouseUp;
    if (event.type == NSEventTypeRightMouseUp || (isLeft && event.modifierFlags & NSEventModifierFlagControl))
        return [self emit:@"right-click"];
    [self emit:event.type == NSEventTypeOtherMouseUp ? @"middle-click" : @"click"];
    if (isLeft && event.clickCount == 2)
        [self emit:@"double-click"];
}

- (void)mouseEntered:(NSEvent*)event { [self emit:@"mouse-enter"]; }
- (void)mouseExited:(NSEvent*)event { [self emit:@"mouse-leave"]; }

@end

static NSMutableDictionary<NSNumber*, BunDesktopTray*>* trays;

static void removeTray(NSNumber* identifier)
{
    NSStatusItem* item = trays[identifier].item;
    if (item)
        [NSStatusBar.systemStatusBar removeStatusItem:item];
    trays[identifier] = nil;
}

void removeTrays(void)
{
    for (NSNumber* identifier in trays.allKeys)
        removeTray(identifier);
}

static id trayCommand(NSDictionary* arguments)
{
    NSNumber* identifier = arguments[@"id"];
    NSString* operation = arguments[@"op"];
    id value = arguments[@"value"];
    if ([operation isEqual:@"destroy"])
        return removeTray(identifier), nil;
    if ([operation isEqual:@"create"]) {
        BunDesktopTray* tray = [BunDesktopTray new];
        tray.number = identifier;
        tray.item = [NSStatusBar.systemStatusBar statusItemWithLength:NSVariableStatusItemLength];
        NSStatusBarButton* button = tray.item.button;
        button.target = tray;
        button.action = @selector(clicked:);
        button.imagePosition = NSImageLeft;
        [button sendActionOn:NSEventMaskLeftMouseUp | NSEventMaskRightMouseUp | NSEventMaskOtherMouseUp];
        NSTrackingAreaOptions options = NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect;
        [button addTrackingArea:[[NSTrackingArea alloc] initWithRect:NSZeroRect options:options owner:tray userInfo:nil]];
        trays = trays ?: [NSMutableDictionary new];
        trays[identifier] = tray;
    }
    NSStatusItem* item = trays[identifier].item;
    if (!item)
        fail(@"the tray icon was destroyed");
    if ([operation isEqual:@"create"] || [operation isEqual:@"image"])
        item.button.image = image(value, arguments[@"size"], isTrue(arguments[@"template"]));
    else if ([operation isEqual:@"tooltip"])
        item.button.toolTip = text(value);
    else if ([operation isEqual:@"title"])
        item.button.title = text(value) ?: @"";
    else if ([operation isEqual:@"menu"]) {
        NSMenu* menu = list(value) ? buildAlone(value) : nil;
        whenIdle(^{
            item.menu = menu;
        });
    } else {
        NSRect frame = item.button.window.frame;
        return @[ @(frame.origin.x), @(primaryHeight() - NSMaxY(frame)), @(frame.size.width), @(frame.size.height) ];
    }
    return nil;
}

bool menuCommand(NSString* name, id arguments, uint64_t replyNumber, id* result)
{
    if ([name isEqual:@"applicationMenu"])
        changeMainMenuSoon(arguments);
    else if ([name isEqual:@"dockMenu"])
        dock = list(arguments) ? buildAlone(arguments) : nil;
    else if ([name isEqual:@"popUpMenu"]) {
        NSView* view = [BunDesktopView withNumber:arguments[@"window"]];
        if (!view)
            fail(@"the window is not open");
        NSMenu* menu = buildAlone(arguments[@"items"]);
        NSInteger index = (number(arguments[@"positioningItem"]) ?: @-1).integerValue;
        track(replyNumber, menu, ^{
            NSPoint at = NSMakePoint(number(arguments[@"x"]).doubleValue, view.bounds.size.height - number(arguments[@"y"]).doubleValue);
            NSMenuItem* item = index >= 0 && index < menu.numberOfItems ? [menu itemAtIndex:index] : nil;
            if (view.window)
                [menu popUpMenuPositioningItem:item atLocation:at inView:view];
        });
    } else if ([name isEqual:@"popUpTrayMenu"]) {
        NSStatusItem* item = trays[arguments[@"tray"]].item;
        if (!item)
            fail(@"the tray icon was destroyed");
        NSMenu* menu = buildAlone(arguments[@"items"]);
        track(replyNumber, menu, ^{
            NSMenu* usual = item.menu;
            item.menu = menu;
            [item.button performClick:nil];
            item.menu = usual;
        });
    } else if ([name isEqual:@"closePopUpMenu"]) {
        closedPopup = lastPopup;
        [popup cancelTracking];
    } else if ([name isEqual:@"tray"])
        *result = trayCommand(arguments);
    else
        return false;
    return true;
}
