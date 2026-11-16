// What `accessibility.rs` describes, for VoiceOver and the like.
#import "bridge.h"

@interface BunDesktopElement : NSAccessibilityElement
@property NSDictionary* node;
@property (weak) NSView* view;
@end

@implementation BunDesktopElement

- (BOOL)perform:(const char*)action value:(id)value
{
    NSString* json = [[NSString alloc] initWithData:serialize(value ?: NSNull.null) encoding:NSUTF8StringEncoding];
    bd_accessibility_action([_node[@"id"] unsignedLongLongValue], action, json.UTF8String);
    return YES;
}

- (bool)is:(NSString*)roles { return [[roles componentsSeparatedByString:@" "] containsObject:_node[@"role"] ?: @""]; }
- (bool)isField { return [self is:@"textbox multilineTextbox passwordbox searchbox"]; }
- (bool)isAdjustable { return [self is:@"slider spinbutton"]; }

- (NSAccessibilityRole)accessibilityRole
{
    static NSDictionary* roles;
    roles = roles ?: @{
        @"button" : NSAccessibilityButtonRole, @"cell" : NSAccessibilityCellRole, @"checkbox" : NSAccessibilityCheckBoxRole,
        @"columnheader" : NSAccessibilityCellRole, @"combobox" : NSAccessibilityComboBoxRole, @"document" : @"AXWebArea",
        @"grid" : NSAccessibilityTableRole, @"gridcell" : NSAccessibilityCellRole, @"heading" : @"AXHeading",
        @"image" : NSAccessibilityImageRole, @"img" : NSAccessibilityImageRole, @"link" : NSAccessibilityLinkRole,
        @"list" : NSAccessibilityListRole, @"listbox" : NSAccessibilityListRole, @"menu" : NSAccessibilityMenuRole,
        @"menubar" : NSAccessibilityMenuBarRole, @"menuitem" : NSAccessibilityMenuItemRole,
        @"menuitemcheckbox" : NSAccessibilityMenuItemRole, @"menuitemradio" : NSAccessibilityMenuItemRole,
        @"meter" : NSAccessibilityLevelIndicatorRole, @"multilineTextbox" : NSAccessibilityTextAreaRole,
        @"option" : NSAccessibilityStaticTextRole, @"passwordbox" : NSAccessibilityTextFieldRole,
        @"progressbar" : NSAccessibilityProgressIndicatorRole, @"radio" : NSAccessibilityRadioButtonRole,
        @"radiogroup" : NSAccessibilityRadioGroupRole, @"row" : NSAccessibilityRowRole, @"rowheader" : NSAccessibilityCellRole,
        @"scrollbar" : NSAccessibilityScrollBarRole, @"searchbox" : NSAccessibilityTextFieldRole,
        @"separator" : NSAccessibilitySplitterRole, @"slider" : NSAccessibilitySliderRole,
        @"spinbutton" : NSAccessibilityIncrementorRole, @"switch" : NSAccessibilityCheckBoxRole,
        @"tab" : NSAccessibilityRadioButtonRole, @"table" : NSAccessibilityTableRole, @"tablist" : NSAccessibilityTabGroupRole,
        @"text" : NSAccessibilityStaticTextRole, @"textbox" : NSAccessibilityTextFieldRole, @"toolbar" : NSAccessibilityToolbarRole,
        @"tree" : NSAccessibilityOutlineRole, @"treegrid" : NSAccessibilityTableRole, @"treeitem" : NSAccessibilityRowRole,
    };
    return roles[_node[@"role"] ?: @""] ?: NSAccessibilityGroupRole;
}

- (NSAccessibilitySubrole)accessibilitySubrole
{
    static NSDictionary* subroles;
    subroles = subroles ?: @{
        @"alert" : @"AXApplicationAlert", @"alertdialog" : @"AXApplicationAlertDialog", @"article" : @"AXDocumentArticle",
        @"banner" : @"AXLandmarkBanner", @"complementary" : @"AXLandmarkComplementary", @"contentinfo" : @"AXLandmarkContentInfo",
        @"dialog" : @"AXApplicationDialog", @"log" : @"AXApplicationLog", @"main" : @"AXLandmarkMain",
        @"navigation" : @"AXLandmarkNavigation", @"passwordbox" : NSAccessibilitySecureTextFieldSubrole, @"region" : @"AXLandmarkRegion",
        @"search" : @"AXLandmarkSearch", @"searchbox" : NSAccessibilitySearchFieldSubrole, @"status" : @"AXApplicationStatus",
        @"switch" : NSAccessibilitySwitchSubrole, @"tab" : NSAccessibilityTabButtonSubrole, @"treeitem" : NSAccessibilityOutlineRowSubrole,
    };
    return subroles[_node[@"role"] ?: @""];
}

- (NSString*)accessibilityRoleDescription { return NSAccessibilityRoleDescription(self.accessibilityRole, self.accessibilitySubrole); }
- (NSString*)accessibilityLabel { return [self is:@"text"] ? nil : text(_node[@"label"]); }
- (NSString*)accessibilityHelp { return text(_node[@"description"]); }
- (NSString*)accessibilityPlaceholderValue { return text(_node[@"placeholder"]); }
- (NSURL*)accessibilityURL { return text(_node[@"url"]) ? [NSURL URLWithString:_node[@"url"]] : nil; }
- (id)accessibilityMinValue { return number(_node[@"min"]); }
- (id)accessibilityMaxValue { return number(_node[@"max"]); }
- (BOOL)isAccessibilityEnabled { return !isTrue(_node[@"disabled"]); }
- (BOOL)isAccessibilityExpanded { return isTrue(_node[@"expanded"]); }
- (BOOL)isAccessibilitySelected { return isTrue(_node[@"selected"]); }
- (BOOL)isAccessibilityRequired { return isTrue(_node[@"required"]); }
- (BOOL)isAccessibilityModal { return isTrue(_node[@"modal"]); }
- (BOOL)isAccessibilityFocused { return _view.accessibilityFocusedUIElement == self; }
- (NSInteger)accessibilityNumberOfCharacters { return text(self.accessibilityValue).length; }

- (NSString*)accessibilityStringForRange:(NSRange)range
{
    NSString* all = text(self.accessibilityValue);
    return NSMaxRange(range) <= all.length ? [all substringWithRange:range] : nil;
}

- (id)accessibilityValue
{
    id toggled = _node[@"checked"] ?: _node[@"pressed"] ?: [self is:@"tab"] ? _node[@"selected"] : nil;
    if (text(toggled) || number(toggled))
        return text(toggled) ? @2 : @([toggled intValue]);
    if ([self is:@"text option"])
        return text(_node[@"value"]) ?: text(_node[@"label"]);
    return text(_node[@"value"]) ?: number(_node[@"now"]) ?: number(_node[@"level"]) ?: self.isField ? @"" : nil;
}

- (NSRect)accessibilityFrame
{
    NSArray* bounds = _node[@"bounds"];
    CGFloat height = [bounds[3] doubleValue], y = _view.bounds.size.height - [bounds[1] doubleValue] - height;
    return NSAccessibilityFrameInView(_view, NSMakeRect([bounds[0] doubleValue], y, [bounds[2] doubleValue], height));
}

- (BOOL)isAccessibilitySelectorAllowed:(SEL)selector
{
    if (selector == @selector(accessibilityPerformPress))
        return self.isAccessibilityEnabled && isTrue(_node[@"clickable"]);
    if (selector == @selector(setAccessibilityFocused:))
        return self.isAccessibilityEnabled && isTrue(_node[@"focusable"]);
    if (selector == @selector(setAccessibilityValue:))
        return self.isAccessibilityEnabled && (self.isField || self.isAdjustable) && !isTrue(_node[@"readonly"]);
    if (selector == @selector(accessibilityPerformIncrement) || selector == @selector(accessibilityPerformDecrement))
        return self.isAccessibilityEnabled && self.isAdjustable;
    if (selector == @selector(setAccessibilityExpanded:) || selector == @selector(isAccessibilityExpanded))
        return number(_node[@"expanded"]) != nil;
    return [super isAccessibilitySelectorAllowed:selector];
}

- (BOOL)accessibilityPerformPress { return [self perform:"click" value:nil]; }
- (BOOL)accessibilityPerformIncrement { return [self perform:"increment" value:nil]; }
- (BOOL)accessibilityPerformDecrement { return [self perform:"decrement" value:nil]; }
- (BOOL)accessibilityPerformShowMenu { return [self perform:"showContextMenu" value:nil]; }
- (void)setAccessibilityFocused:(BOOL)isFocused { [self perform:isFocused ? "focus" : "blur" value:nil]; }
- (void)setAccessibilityExpanded:(BOOL)isExpanded { [self perform:isExpanded ? "expand" : "collapse" value:nil]; }
- (void)setAccessibilityValue:(id)value { [self perform:"setValue" value:number(value) ?: text(value) ?: @""]; }

@end

@implementation BunDesktopTree {
    __weak NSView* view;
    NSDictionary<NSNumber*, BunDesktopElement*>* elements;
}

- (instancetype)initWithView:(NSView*)owner
{
    self = [super init];
    view = owner;
    return self;
}

- (void)update:(NSDictionary*)tree
{
    NSMutableDictionary<NSNumber*, BunDesktopElement*>* next = [NSMutableDictionary new];
    NSMutableArray* changed = [NSMutableArray new];
    for (NSDictionary* node in tree[@"nodes"]) {
        BunDesktopElement* known = elements[node[@"id"]];
        BunDesktopElement* element = next[node[@"id"]] = known ?: [BunDesktopElement new];
        id before = known.accessibilityValue;
        element.node = node;
        element.view = view;
        if (before && ![before isEqual:element.accessibilityValue])
            [changed addObject:element];
    }
    NSArray* (^adopt)(id, NSArray*) = ^(id parent, NSArray* numbers) {
        NSMutableArray* children = [[next objectsForKeys:list(numbers) ?: @[] notFoundMarker:(id)NSNull.null] mutableCopy];
        [children removeObjectIdenticalTo:NSNull.null];
        [children makeObjectsPerformSelector:@selector(setAccessibilityParent:) withObject:parent];
        return children;
    };
    for (BunDesktopElement* element in next.allValues)
        element.accessibilityChildren = adopt(element, element.node[@"children"]);
    _roots = adopt(view, tree[@"roots"]);
    for (NSNumber* gone in elements)
        if (!next[gone])
            NSAccessibilityPostNotification(elements[gone], NSAccessibilityUIElementDestroyedNotification);
    bool hasOtherElements = ![[NSSet setWithArray:next.allKeys] isEqual:[NSSet setWithArray:elements.allKeys ?: @[]]];
    elements = next;
    if (hasOtherElements)
        NSAccessibilityPostNotification(view, NSAccessibilityLayoutChangedNotification);
    for (id element in changed)
        NSAccessibilityPostNotification(element, NSAccessibilityValueChangedNotification);
    id focus = next[number(tree[@"focus"]) ?: @-1];
    if (focus != _focus && (_focus = focus))
        NSAccessibilityPostNotification(focus, NSAccessibilityFocusedUIElementChangedNotification);
}

- (id)at:(NSPoint)onScreen
{
    id found = nil;
    for (NSArray* level = _roots; level.count;) {
        NSUInteger index = [level indexOfObjectWithOptions:NSEnumerationReverse passingTest:^BOOL(id element, NSUInteger unused, BOOL* stop) {
            return NSPointInRect(onScreen, [element accessibilityFrame]);
        }];
        if (index == NSNotFound)
            break;
        found = level[index];
        level = [found accessibilityChildren];
    }
    return found;
}

@end
