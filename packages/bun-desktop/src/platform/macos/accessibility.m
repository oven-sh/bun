// The objects through which VoiceOver and the like reach `accessibility/cocoa.rs`.
#import "bridge.h"
#import <Accessibility/Accessibility.h>

#pragma clang diagnostic ignored "-Wdeprecated-declarations"
#pragma clang diagnostic ignored "-Wdeprecated-implementations"

static NSMutableDictionary<NSNumber*, id>* elements;

static id ofClass(id value, Class expected) { return [value isKindOfClass:expected] ? value : nil; }
static NSString* text(id value) { return ofClass(value, NSString.class); }
static NSArray* list(id value) { return ofClass(value, NSArray.class); }
static NSNumber* number(id value) { return ofClass(value, NSNumber.class); }
static const char* utf8(NSString* value) { return value.UTF8String ?: ""; }
static BunDesktopView* viewOf(uint32_t window) { return [BunDesktopView withNumber:window]; }

static NSRect onScreen(uint32_t window, BDRect rect)
{
    NSView* view = viewOf(window);
    return NSAccessibilityFrameInView(view, NSMakeRect(rect.x, view.bounds.size.height - rect.y - rect.height, rect.width, rect.height));
}

static BDRect inWindow(uint32_t window, NSRect rect)
{
    NSView* view = viewOf(window);
    rect = [view convertRect:[view.window convertRectFromScreen:rect] fromView:nil];
    return (BDRect) { rect.origin.x, view.bounds.size.height - NSMaxY(rect), rect.size.width, rect.size.height };
}

static bool isMarker(id value) { return value && CFGetTypeID((__bridge CFTypeRef)value) == AXTextMarkerGetTypeID(); }
static bool isMarkerRange(id value) { return value && CFGetTypeID((__bridge CFTypeRef)value) == AXTextMarkerRangeGetTypeID(); }

static bool readMarker(id value, BDMarker* marker)
{
    if (!isMarker(value) || AXTextMarkerGetLength((__bridge AXTextMarkerRef)value) != sizeof *marker)
        return false;
    memcpy(marker, AXTextMarkerGetBytePtr((__bridge AXTextMarkerRef)value), sizeof *marker);
    return true;
}

@interface BunDesktopElement : NSObject <AXCustomContentProvider>
@property uint64_t node;
@end

static uint64_t nodeOf(id value) { return [value isKindOfClass:BunDesktopElement.class] ? [value node] : 0; }

/// The strings live as long as the autorelease pool.
static BDParameter decode(id value, uint64_t node)
{
    BDParameter it = { .kind = BDNothing };
    if ([value isKindOfClass:NSDictionary.class] && value[@"AXTextMarkerRange"])
        value = value[@"AXTextMarkerRange"];
    if (isMarkerRange(value)) {
        AXTextMarkerRangeRef range = (__bridge AXTextMarkerRangeRef)value;
        value = @[ CFBridgingRelease(AXTextMarkerRangeCopyStartMarker(range)), CFBridgingRelease(AXTextMarkerRangeCopyEndMarker(range)) ];
    }
    if (isMarker(value)) {
        it.kind = readMarker(value, it.markers) ? BDOneMarker : BDNothing;
    } else if (number(value)) {
        it = (BDParameter) { .kind = BDNumber, .numbers = { [value doubleValue] } };
    } else if (text(value) || [value isKindOfClass:NSAttributedString.class]) {
        it = (BDParameter) { .kind = BDString, .text = utf8(text(value) ?: [value string]) };
    } else if (nodeOf(value)) {
        it = (BDParameter) { .kind = BDElement, .markers = { { .node = nodeOf(value) } } };
    } else if (list(value).count == 2 && number(value[0]) && number(value[1])) {
        it = (BDParameter) { .kind = BDTwoNumbers, .numbers = { [value[0] doubleValue], [value[1] doubleValue] } };
    } else if (list(value).count == 2) {
        it.kind = readMarker(value[0], it.markers) && readMarker(value[1], it.markers + 1) ? BDTwoMarkers : BDNothing;
    } else if ([value isKindOfClass:NSValue.class]) {
        bool isPoint = !strcmp([value objCType], @encode(NSPoint));
        if (!strcmp([value objCType], @encode(NSRange))) {
            it = (BDParameter) { .kind = BDSpan, .numbers = { [value rangeValue].location, [value rangeValue].length } };
        } else if (isPoint || !strcmp([value objCType], @encode(NSRect))) {
            NSRect given = isPoint ? (NSRect) { [value pointValue], NSZeroSize } : [value rectValue];
            BDRect rect = inWindow(bd_accessibility_window(node), given);
            it = (BDParameter) { .kind = isPoint ? BDSpot : BDArea, .numbers = { rect.x, rect.y, rect.width, rect.height } };
        }
    } else if ([value isKindOfClass:NSDictionary.class] && text(value[@"AXReplacementText"])) {
        id range = value[@"AXReplacementRange"];
        CFRange span = {};
        if ([range isKindOfClass:NSValue.class])
            span = CFRangeMake([range rangeValue].location, [range rangeValue].length);
        else if (!range || CFGetTypeID((__bridge CFTypeRef)range) != AXValueGetTypeID() || !AXValueGetValue((__bridge AXValueRef)range, kAXValueTypeCFRange, &span))
            return it;
        it = (BDParameter) { .kind = BDReplacement, .numbers = { span.location, span.length }, .text = utf8(value[@"AXReplacementText"]) };
    } else if ([value isKindOfClass:NSDictionary.class]) {
        NSString* keys = text(value[@"AXSearchKey"]) ?: [list(value[@"AXSearchKey"]) componentsJoinedByString:@" "] ?: @"";
        it = (BDParameter) {
            .kind = BDSearch,
            .numbers = { [value[@"AXDirection"] isEqual:@"AXDirectionPrevious"], (number(value[@"AXResultsLimit"]) ?: @-1).doubleValue,
                number(value[@"AXVisibleOnly"]).boolValue, number(value[@"AXImmediateDescendantsOnly"]).boolValue },
            .markers = { { .node = nodeOf(value[@"AXStartElement"]) } },
            .text = utf8(text(value[@"AXSearchText"])),
            .keys = utf8(keys),
        };
    }
    return it;
}

@implementation BunDesktopElement

- (BOOL)isAccessibilityElement { return YES; }
- (BOOL)accessibilityIsIgnored { return NO; }
- (BOOL)accessibilityNotifiesWhenDestroyed { return YES; }
- (NSArray*)accessibilityAttributeNames { return CFBridgingRelease(bd_accessibility_names(_node, BDAttributes)); }
- (NSArray*)accessibilityParameterizedAttributeNames { return CFBridgingRelease(bd_accessibility_names(_node, BDParameterizedAttributes)); }
- (NSArray*)accessibilityActionNames { return CFBridgingRelease(bd_accessibility_names(_node, BDActions)); }
- (NSString*)accessibilityActionDescription:(NSString*)action { return NSAccessibilityActionDescription(action); }
- (void)accessibilityPerformAction:(NSString*)action { bd_accessibility_act(_node, utf8(action)); }
- (id)accessibilityAttributeValue:(NSString*)name { return CFBridgingRelease(bd_accessibility_value(_node, utf8(name), NULL)); }
- (BOOL)accessibilityIsAttributeSettable:(NSString*)name { return bd_accessibility_is_settable(_node, utf8(name)); }
- (id)accessibilityFocusedUIElement { return viewOf(bd_accessibility_window(_node)).accessibilityFocusedUIElement; }
- (NSRect)accessibilityFrame { return [[self accessibilityAttributeValue:@"AXFrame"] rectValue]; }

- (id)accessibilityAttributeValue:(NSString*)name forParameter:(id)parameter
{
    BDParameter decoded = decode(parameter, _node);
    if (decoded.kind == BDReplacement)
        return @(bd_accessibility_set(_node, utf8(name), &decoded));
    return CFBridgingRelease(bd_accessibility_value(_node, utf8(name), &decoded));
}

- (void)accessibilitySetValue:(id)value forAttribute:(NSString*)name
{
    BDParameter decoded = decode(value, _node);
    bd_accessibility_set(_node, utf8(name), &decoded);
}

- (BOOL)accessibilityReplaceRange:(NSRange)range withText:(NSString*)replacement
{
    BDParameter it = { .kind = BDReplacement, .numbers = { range.location, range.length }, .text = utf8(replacement) };
    return bd_accessibility_set(_node, "AXReplaceRangeWithText", &it);
}

- (id)accessibilityHitTest:(NSPoint)point { return accessibleAt(bd_accessibility_window(_node), _node, point) ?: self; }

- (NSArray<AXCustomContent*>*)accessibilityCustomContent
{
    NSString* description = CFBridgingRelease(bd_accessibility_custom_description(_node));
    if (!description)
        return nil;
    AXCustomContent* content = [AXCustomContent customContentWithLabel:@"description" value:description];
    content.importance = AXCustomContentImportanceHigh;
    return @[ content ];
}

- (void)setAccessibilityCustomContent:(NSArray<AXCustomContent*>*)content { }

@end

id accessibleAt(uint32_t window, uint64_t within, NSPoint point)
{
    BDRect at = inWindow(window, (NSRect) { point, NSZeroSize });
    return CFBridgingRelease(bd_accessibility_hit(window, within, at.x, at.y));
}

// ───────────────────────────── who is listening ─────────────────────────────

static bool isEnhanced, isManual;

bool bd_has_screen_reader(void)
{
    NSWorkspace* workspace = NSWorkspace.sharedWorkspace;
    return isManual || workspace.isVoiceOverEnabled || workspace.isSwitchControlEnabled;
}

static void clientsChanged(void) { bd_accessibility_clients(isEnhanced, bd_has_screen_reader()); }

@implementation BunDesktopApplication

- (void)watchForScreenReaders
{
    for (NSString* key in @[ @"voiceOverEnabled", @"switchControlEnabled" ])
        [NSWorkspace.sharedWorkspace addObserver:self forKeyPath:key options:NSKeyValueObservingOptionInitial context:&isManual];
}

- (void)observeValueForKeyPath:(NSString*)key ofObject:(id)object change:(NSDictionary*)change context:(void*)context
{
    if (context != &isManual)
        return [super observeValueForKeyPath:key ofObject:object change:change context:context];
    soon(^{
        clientsChanged();
    });
}

- (NSArray*)accessibilityAttributeNames { return [[super accessibilityAttributeNames] arrayByAddingObject:@"AXManualAccessibility"]; }
- (id)accessibilityAttributeValue:(NSString*)name { return [name isEqual:@"AXManualAccessibility"] ? @(isManual) : [super accessibilityAttributeValue:name]; }
- (BOOL)accessibilityIsAttributeSettable:(NSString*)name { return [name isEqual:@"AXManualAccessibility"] || [super accessibilityIsAttributeSettable:name]; }

- (void)accessibilitySetValue:(id)value forAttribute:(NSString*)name
{
    if ([name isEqual:@"AXManualAccessibility"]) {
        isManual = number(value).boolValue;
        return clientsChanged();
    }
    if ([name isEqual:@"AXEnhancedUserInterface"]) {
        isEnhanced = number(value).boolValue;
        clientsChanged();
    }
    [super accessibilitySetValue:value forAttribute:name];
}

/// Voice Control and others do not announce themselves.
- (NSAccessibilityRole)accessibilityRole
{
    bd_accessibility_was_used(0);
    return super.accessibilityRole;
}

@end

// ───────────────────────────── for Rust, which owns what it gets and hands over what it passes ─────────────────────────────

static void* retained(id value) { return (void*)CFBridgingRetain(value ?: NSNull.null); }

void* bd_make_number(double value, bool isBoolean)
{
    if (isBoolean || isinf(value))
        return retained(isBoolean ? @((BOOL)(value != 0)) : @(NSNotFound));
    return retained(fabs(value) < 1e15 && value == round(value) ? @((int64_t)value) : @(value));
}

void* bd_make_range(size_t start, size_t length) { return retained([NSValue valueWithRange:NSMakeRange(start, length)]); }
void* bd_make_view(uint32_t window, bool isWindow) { return retained(isWindow ? viewOf(window).window : viewOf(window)); }
void* bd_make_marker(BDMarker marker) { return (void*)AXTextMarkerCreate(kCFAllocatorDefault, (const UInt8*)&marker, sizeof marker); }

void* bd_make_text(const unichar* units, size_t length, BDTextKind kind)
{
    NSString* it = [NSString stringWithCharacters:units length:length];
    if (kind == BDLink)
        return retained([NSURL URLWithString:it]);
    if (kind == BDAttributed)
        return retained([[NSMutableAttributedString alloc] initWithString:it]);
    return retained(it);
}

void* bd_make_role_description(void* phrase, void* role, void* subrole)
{
    static NSBundle* translations;
    translations = translations ?: [NSBundle bundleWithPath:@"/System/Library/Frameworks/WebKit.framework/Frameworks/WebCore.framework"];
    NSArray<NSString*>* parts = [CFBridgingRelease(phrase) componentsSeparatedByString:@"|"];
    NSString* ofSystem = NSAccessibilityRoleDescription(CFBridgingRelease(role), CFBridgingRelease(subrole));
    if (!parts || [NSBundle.mainBundle.preferredLocalizations.firstObject hasPrefix:@"en"])
        return retained(parts[0] ?: ofSystem);
    NSString* translated = [translations localizedStringForKey:parts.lastObject value:parts.lastObject table:nil];
    return retained(translated && ![translated isEqual:parts.lastObject] ? translated : ofSystem);
}

void* bd_make_color(uint32_t rgba)
{
    return CGColorCreateSRGB((rgba >> 24) / 255., (rgba >> 16 & 255) / 255., (rgba >> 8 & 255) / 255., (rgba & 255) / 255.);
}

void* bd_make_element(uint64_t node)
{
    elements = elements ?: [NSMutableDictionary new];
    BunDesktopElement* element = elements[@(node)];
    if (!element) {
        elements[@(node)] = element = [BunDesktopElement new];
        element.node = node;
    }
    return retained(element);
}

void* bd_make_place(uint32_t window, BDRect rect, BDPlaceKind kind)
{
    if (kind == BDExtent)
        return retained([NSValue valueWithSize:NSMakeSize(rect.width, rect.height)]);
    NSRect frame = onScreen(window, rect);
    return retained(kind == BDOrigin ? [NSValue valueWithPoint:frame.origin] : [NSValue valueWithRect:frame]);
}

void* bd_make_marker_range(BDMarker start, BDMarker end)
{
    id ends[] = { CFBridgingRelease(bd_make_marker(start)), CFBridgingRelease(bd_make_marker(end)) };
    return (void*)AXTextMarkerRangeCreate(kCFAllocatorDefault, (__bridge AXTextMarkerRef)ends[0], (__bridge AXTextMarkerRef)ends[1]);
}

void* bd_make_list(void* const* items, size_t count)
{
    NSMutableArray* all = [NSMutableArray arrayWithCapacity:count];
    for (size_t index = 0; index < count; index++)
        [all addObject:CFBridgingRelease(items[index])];
    return retained(all);
}

void* bd_make_dictionary(void* keys, void* values) { return retained([NSDictionary dictionaryWithObjects:CFBridgingRelease(values) forKeys:CFBridgingRelease(keys)]); }

/// `text` stays with the caller.
void bd_add_attribute(void* text, void* name, void* value, size_t start, size_t length)
{
    NSMutableAttributedString* string = (__bridge NSMutableAttributedString*)text;
    [string addAttribute:CFBridgingRelease(name) value:CFBridgingRelease(value) range:NSIntersectionRange(NSMakeRange(start, length), NSMakeRange(0, string.length))];
}

void* bd_unless_null(void* value)
{
    if (value != (__bridge void*)NSNull.null)
        return value;
    CFRelease(value);
    return NULL;
}

bool bd_is_known(uint64_t node) { return elements[@(node)] != nil; }

void bd_forget_element(uint64_t node)
{
    @autoreleasepool {
        id element = elements[@(node)];
        if (element)
            NSAccessibilityPostNotification(element, NSAccessibilityUIElementDestroyedNotification);
        elements[@(node)] = nil;
    }
}

static void post(id element, NSString* notification, NSDictionary* details)
{
    if (details)
        NSAccessibilityPostNotificationWithUserInfo(element, notification, details);
    else
        NSAccessibilityPostNotification(element, notification);
}

void bd_post(void* name, void* target, void* info, bool isDelayed)
{
    @autoreleasepool {
        id notification = CFBridgingRelease(name), element = CFBridgingRelease(bd_unless_null(target)), details = CFBridgingRelease(info);
        if (!element)
            return;
        if (!isDelayed)
            return post(element, notification, details);
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 20 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
            bool isFocus = [notification isEqual:NSAccessibilityFocusedUIElementChangedNotification];
            if (bd_is_known(nodeOf(element)) && (!isFocus || [element accessibilityFocusedUIElement] == element))
                post(element, notification, details);
        });
    }
}
