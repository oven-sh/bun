// Menus, and icons in the menu bar.
#import "bridge.h"

static NSEvent* sentKey;
static NSMenu *dock, *popup;
static uint32_t lastPopup, closedPopup;
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
    emit(BDSystemEventMenu, .menu = { item.tag, key.modifierFlags & NSEventModifierFlagCommand });
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

static NSImage* image(NSData* data, BDSize size, bool isTemplate)
{
    NSImage* image = data ? [[NSImage alloc] initWithData:data] : nil;
    image.size = NSMakeSize(size.width, size.height);
    image.template = isTemplate;
    return image;
}

NSImage* imageOf(BDIcon icon) { return image(dataIfAny(icon.bytes), icon.size, icon.isTemplate); }

@implementation NSSharingService (BunDesktop)
- (void)bunDesktopShare:(NSMenuItem*)item { [self performWithItems:item.representedObject[1]]; }
@end

static NSArray* sharedItems(const BDShared* shared)
{
    NSMutableArray* all = [strings(shared->texts) mutableCopy];
    forEach(it, shared->files) [all addObject:[NSURL fileURLWithPath:string(*it)]];
    forEach(it, shared->urls) {
        NSURL* url = [NSURL URLWithString:string(*it)];
        if (url)
            [all addObject:url];
    }
    return all;
}

static NSMenu* sharingMenu(NSArray* shared)
{
    NSMenu* menu = [NSMenu new];
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    for (NSSharingService* service in [NSSharingService sharingServicesForItems:shared]) {
#pragma clang diagnostic pop
        NSMenuItem* item = [menu addItemWithTitle:service.menuItemTitle action:@selector(bunDesktopShare:) keyEquivalent:@""];
        item.image = service.image;
        item.target = service;
        item.representedObject = @[ service, shared ];
    }
    return menu;
}

/// A copy of a `BDMenuItem`.
@interface BunDesktopItem : NSObject {
@public
    uint32_t number;
    BDMenuItemKind kind;
    BDMenuRole role;
    bool isEnabled, isChecked, isTemplate;
    uint8_t modifiers;
    BDSize iconSize;
    NSString *label, *sublabel, *toolTip, *key;
    NSData* icon;
    NSArray<BunDesktopItem*>* submenu;
    NSArray* shared;
}
@end

@implementation BunDesktopItem
@end

typedef NSArray<BunDesktopItem*>* Template;

static Template copyOf(BDListMenuItem items)
{
    NSMutableArray* all = [NSMutableArray new];
    forEach(from, items) {
        BunDesktopItem* item = [BunDesktopItem new];
        item->number = from->id;
        item->kind = from->kind;
        item->role = from->role;
        item->isEnabled = from->isEnabled;
        item->isChecked = from->isChecked;
        item->label = string(from->label);
        item->sublabel = stringIfAny(from->sublabel);
        item->toolTip = stringIfAny(from->toolTip);
        if (from->accelerator.has) {
            item->key = string(from->accelerator.value.key);
            item->modifiers = from->accelerator.value.modifiers;
        }
        if (from->icon.has) {
            item->icon = dataIfAny(from->icon.value.bytes);
            item->iconSize = from->icon.value.size;
            item->isTemplate = from->icon.value.isTemplate;
        }
        item->submenu = from->submenu.has ? copyOf(from->submenu.value) : nil;
        item->shared = from->shared.has ? sharedItems(&from->shared.value) : nil;
        [all addObject:item];
    }
    return all;
}

static NSString* const windowActionsOf[BDMenuRoleHelp + 1] = {
    [BDMenuRoleClose] = @"performClose:", [BDMenuRoleMinimize] = @"performMiniaturize:", [BDMenuRoleUndo] = @"undo:", [BDMenuRoleRedo] = @"redo:"
};
static NSString* const editsOf[BDMenuRoleHelp + 1] = {
    [BDMenuRoleCut] = @"cut:", [BDMenuRoleCopy] = @"copy:", [BDMenuRolePaste] = @"paste:", [BDMenuRoleSelectAll] = @"selectAll:"
};

static void update(NSMenuItem* item, BunDesktopItem* from)
{
    if (![item.title isEqual:from->label])
        item.title = from->label;
    item.tag = from->number;
    item.enabled = from->isEnabled && from->kind != BDMenuItemKindHeader;
    item.state = from->isChecked ? NSControlStateValueOn : NSControlStateValueOff;
    item.toolTip = from->toolTip;
    if ([item respondsToSelector:NSSelectorFromString(@"setSubtitle:")])
        [item setValue:from->sublabel forKey:@"subtitle"];
    windowActions = windowActions ?: [NSMutableDictionary new];
    windowActions[@(item.tag)] = windowActionsOf[from->role];
}

/// `items` gets one object for each item, depth first, and `special` the menus that AppKit adds to.
static NSMenu* build(NSString* title, Template template, NSMutableArray* items, NSMutableDictionary* special)
{
    NSMenu* menu = [[NSMenu alloc] initWithTitle:title];
    menu.autoenablesItems = NO;
    for (BunDesktopItem* from in template) {
        if (from->kind == BDMenuItemKindSeparator) {
            [items addObject:NSNull.null];
            [menu addItem:NSMenuItem.separatorItem];
            continue;
        }
        bool isHeader = from->kind == BDMenuItemKindHeader && [NSMenuItem respondsToSelector:@selector(sectionHeaderWithTitle:)];
        NSMenuItem* item = isHeader ? [NSMenuItem sectionHeaderWithTitle:from->label] : [NSMenuItem new];
        [items addObject:item];
        if (isHeader) {
            [menu addItem:item];
            continue;
        }
        update(item, from);
        item.image = image(from->icon, from->iconSize, from->isTemplate);
        if (from->shared) {
            item.submenu = sharingMenu(from->shared);
        } else if (from->submenu || from->role == BDMenuRoleServices) {
            item.submenu = special[@(from->role)] = build(from->label, from->submenu, items, special);
        } else {
            item.action = NSSelectorFromString(editsOf[from->role] ?: @"choseMenuItem:");
            if (from->key.length) {
                int bits = from->modifiers;
                item.keyEquivalent = keyEquivalent(from->key);
                item.keyEquivalentModifierMask = (bits & 1 ? NSEventModifierFlagShift : 0) | (bits & 2 ? NSEventModifierFlagControl : 0)
                    | (bits & 4 ? NSEventModifierFlagOption : 0) | (bits & 8 ? NSEventModifierFlagCommand : 0);
            }
        }
        [menu addItem:item];
    }
    return menu;
}

static NSMenu* buildAlone(BDListMenuItem items) { return build(@"", copyOf(items), nil, [NSMutableDictionary new]); }

static void forEachItem(Template template, void (^body)(BunDesktopItem*))
{
    for (BunDesktopItem* item in template) {
        body(item);
        forEachItem(item->submenu, body);
    }
}

static void changeMainMenu(Template template)
{
    static NSArray *lastShape, *lastItems;
    NSMutableArray* shape = [NSMutableArray new];
    // What `update` cannot change.
    forEachItem(template, ^(BunDesktopItem* item) {
        [shape addObject:@[ @(item->kind), @(item->role), item->key ?: @"", @(item->modifiers), item->icon ?: NSNull.null, item->shared ?: NSNull.null ]];
        [shape addObject:item->submenu ? @[ @(item->submenu.count), item->label ] : NSNull.null];
    });
    [windowActions removeAllObjects];
    if (lastItems.count && [shape isEqual:lastShape]) {
        NSEnumerator* each = lastItems.objectEnumerator;
        return forEachItem(template, ^(BunDesktopItem* from) {
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
        NSApp.servicesMenu = special[@(BDMenuRoleServices)];
        NSApp.windowsMenu = special[@(BDMenuRoleWindow)];
        NSApp.helpMenu = special[@(BDMenuRoleHelp)];
    });
}

/// Apps replace it many times in a row, and AppKit takes its time over each.
static void changeMainMenuSoon(Template template)
{
    static Template next;
    bool isWaiting = next;
    next = template;
    if (isWaiting)
        return;
    NSTimer* timer = [NSTimer timerWithTimeInterval:0.05 repeats:NO block:^(NSTimer* unused) {
        Template last = next;
        next = nil;
        changeMainMenu(last);
    }];
    [NSRunLoop.mainRunLoop addTimer:timer forMode:NSRunLoopCommonModes];
}

/// Replies when it has closed.
static void track(uint32_t replyNumber, NSMenu* menu, void (^show)(void))
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
            reply(replyNumber, BDReplyDone);
        }
    });
}

@interface BunDesktopTray : NSResponder
@property uint32_t number;
@property NSStatusItem* item;
@end

@implementation BunDesktopTray

- (void)report:(BDTrayEvent)event
{
    NSPoint at = NSEvent.mouseLocation;
    emit(BDSystemEventTray, .tray = { _number, event, { at.x, primaryHeight() - at.y } });
}

- (void)clicked:(id)sender
{
    NSEvent* event = NSApp.currentEvent;
    bool isLeft = event.type == NSEventTypeLeftMouseUp;
    if (event.type == NSEventTypeRightMouseUp || (isLeft && event.modifierFlags & NSEventModifierFlagControl))
        return [self report:BDTrayEventRightClick];
    [self report:event.type == NSEventTypeOtherMouseUp ? BDTrayEventMiddleClick : BDTrayEventClick];
    if (isLeft && event.clickCount == 2)
        [self report:BDTrayEventDoubleClick];
}

- (void)mouseEntered:(NSEvent*)event { [self report:BDTrayEventMouseEnter]; }
- (void)mouseExited:(NSEvent*)event { [self report:BDTrayEventMouseLeave]; }

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

static NSStatusItem* statusItem(uint32_t identifier)
{
    NSStatusItem* item = trays[@(identifier)].item;
    if (!item)
        fail(@"the tray icon was destroyed");
    return item;
}

static void setIcon(uint32_t identifier, BDIcon icon) { statusItem(identifier).button.image = imageOf(icon); }

static void trayCommand(uint32_t identifier, const BDTrayCommand* command)
{
    switch (command->tag) {
    case BDTrayCommandCreate: {
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
        trays[@(identifier)] = tray;
        return setIcon(identifier, command->create.icon);
    }
    case BDTrayCommandDestroy: return removeTray(@(identifier));
    case BDTrayCommandIcon: return setIcon(identifier, command->icon);
    case BDTrayCommandToolTip: return (void)(statusItem(identifier).button.toolTip = stringIfAny(command->toolTip));
    case BDTrayCommandTitle: return (void)(statusItem(identifier).button.title = string(command->title));
    case BDTrayCommandMenu: {
        NSStatusItem* item = statusItem(identifier);
        NSMenu* menu = command->menu.has ? buildAlone(command->menu.value) : nil;
        return whenIdle(^{
            item.menu = menu;
        });
    }
    }
}

BDRect bd_tray_bounds(uint32_t identifier)
{
    @autoreleasepool {
        NSRect frame = trays[@(identifier)].item.button.window.frame;
        return (BDRect) { frame.origin.x, primaryHeight() - NSMaxY(frame), frame.size.width, frame.size.height };
    }
}

void menuCommand(const BDSystemCommand* command)
{
    if (command->tag == BDSystemCommandApplicationMenu)
        changeMainMenuSoon(copyOf(command->applicationMenu));
    else if (command->tag == BDSystemCommandDockMenu)
        dock = buildAlone(command->dockMenu);
    else if (command->tag == BDSystemCommandTray)
        trayCommand(command->tray.id, &command->tray.command);
    else {
        closedPopup = lastPopup;
        [popup cancelTracking];
    }
}

void popUpMenu(const BDSystemRequest* request, uint32_t replyNumber)
{
    if (request->tag == BDSystemRequestPopUpTrayMenu) {
        NSStatusItem* item = statusItem(request->popUpTrayMenu.tray);
        NSMenu* menu = buildAlone(request->popUpTrayMenu.items);
        return track(replyNumber, menu, ^{
            NSMenu* usual = item.menu;
            item.menu = menu;
            [item.button performClick:nil];
            item.menu = usual;
        });
    }
    BunDesktopView* view = [BunDesktopView withNumber:request->popUpMenu.window];
    if (!view)
        fail(@"the window is not open");
    NSMenu* menu = buildAlone(request->popUpMenu.items);
    if (request->popUpMenu.isSubmenuOfFirst) {
        NSMenuItem* first = menu.itemArray.firstObject;
        menu = first.submenu;
        first.submenu = nil;
    }
    BDMaybeu32 index = request->popUpMenu.positioningItem;
    BDPoint at = request->popUpMenu.at;
    track(replyNumber, menu, ^{
        NSMenuItem* item = index.has && index.value < menu.numberOfItems ? [menu itemAtIndex:index.value] : nil;
        view.hasMenu = true;
        @try {
            if (view.window)
                [menu popUpMenuPositioningItem:item atLocation:NSMakePoint(at.x, view.bounds.size.height - at.y) inView:view];
        } @finally {
            whenIdle(^{
                view.hasMenu = false;
            });
        }
    });
}
