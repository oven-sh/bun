// The Touch Bar.
#import "bridge.h"
#import <objc/runtime.h>

@interface BunDesktopTouchItem : NSObject <NSScrubberDataSource, NSScrubberDelegate, NSScrubberFlowLayoutDelegate>
@property uint32_t number;
@property (weak) __kindof NSTouchBarItem* item;
@property NSArray<NSString*>* labels;
@property NSArray* images;
@end

static void report(uint32_t item, double value, bool isSelected) { emit(BDSystemEventTouchBar, .touchBar = { item, value, isSelected }); }

@implementation BunDesktopTouchItem

- (void)clicked:(id)sender { report(_number, 0, true); }
- (void)slid:(NSSliderTouchBarItem*)item { report(_number, item.slider.intValue, true); }
- (void)picked:(NSColorPickerTouchBarItem*)item { report(_number, rgba(item.color), true); }
- (void)chose:(NSSegmentedControl*)control { report(_number, control.selectedSegment, [control isSelectedForSegment:control.selectedSegment]); }
- (void)scrubber:(NSScrubber*)scrubber didSelectItemAtIndex:(NSInteger)index { report(_number, index, true); }
- (void)scrubber:(NSScrubber*)scrubber didHighlightItemAtIndex:(NSInteger)index { report(_number, index, false); }
- (NSInteger)numberOfItemsForScrubber:(NSScrubber*)scrubber { return _labels.count; }

- (NSScrubberItemView*)scrubber:(NSScrubber*)scrubber viewForItemAtIndex:(NSInteger)index
{
    if (_images[index] != NSNull.null) {
        NSScrubberImageItemView* view = [scrubber makeItemWithIdentifier:@"image" owner:self];
        view.image = _images[index];
        return view;
    }
    NSScrubberTextItemView* view = [scrubber makeItemWithIdentifier:@"text" owner:self];
    view.title = _labels[index];
    return view;
}

- (NSSize)scrubber:(NSScrubber*)scrubber layout:(NSScrubberFlowLayout*)layout sizeForItemAtIndex:(NSInteger)index
{
    NSDictionary* font = @{ NSFontAttributeName : [NSFont systemFontOfSize:0] };
    CGFloat width = _images[index] != NSNull.null ? [(NSImage*)_images[index] size].width : [_labels[index] sizeWithAttributes:font].width;
    return NSMakeSize(width + 15, 30);
}

@end

static NSHashTable<BunDesktopTouchItem*>* shown;

static NSColor* colorOf(uint32_t it) { return [NSColor colorWithSRGBRed:(it >> 24) / 255. green:(it >> 16 & 255) / 255. blue:(it >> 8 & 255) / 255. alpha:(it & 255) / 255.]; }
static NSImage* imageIfAny(BDMaybeIcon icon) { return icon.has ? imageOf(icon.value) : nil; }

static NSScrubberSelectionStyle* selectionStyle(NSString* name)
{
    return [name isEqual:@"outline"] ? NSScrubberSelectionStyle.outlineOverlayStyle
        : [name isEqual:@"background"] ? NSScrubberSelectionStyle.roundedBackgroundStyle
                                       : nil;
}

static NSTouchBar* barOf(BDListTouchBarItem items);

static void update(BunDesktopTouchItem* owner, const BDTouchBarItem* from)
{
    __kindof NSView* view = owner.item.view;
    NSString *label = string(from->label), *style = string(from->style), *mode = string(from->mode);
    NSColor* color = from->color.has ? colorOf(from->color.value) : nil;
    switch (from->kind) {
    case BDTouchBarKindButton: {
        NSButton* button = view;
        button.bezelColor = color;
        button.accessibilityLabel = stringIfAny(from->accessibilityLabel);
        button.title = label;
        button.image = imageIfAny(from->icon);
        button.imagePosition = [style isEqual:@"left"] ? NSImageLeft : [style isEqual:@"right"] ? NSImageRight : NSImageOverlaps;
        button.enabled = from->isEnabled;
        break;
    }
    case BDTouchBarKindLabel: {
        NSTextField* field = view;
        field.stringValue = label;
        field.accessibilityLabel = stringIfAny(from->accessibilityLabel);
        field.textColor = color;
        break;
    }
    case BDTouchBarKindColorPicker: {
        NSColorPickerTouchBarItem* item = owner.item;
        NSColorList* list = [[NSColorList alloc] initWithName:@""];
        forEach(it, from->colors) [list insertColor:colorOf(*it) key:@(it - from->colors.start).stringValue atIndex:it - from->colors.start];
        if (from->colors.length)
            item.colorList = list;
        if (color)
            item.color = color;
        break;
    }
    case BDTouchBarKindSlider: {
        NSSliderTouchBarItem* item = owner.item;
        item.label = label;
        item.slider.minValue = from->minimum;
        item.slider.maxValue = from->maximum;
        item.slider.doubleValue = from->value;
        break;
    }
    case BDTouchBarKindPopover: {
        NSPopoverTouchBarItem* item = owner.item;
        item.collapsedRepresentationLabel = label;
        item.collapsedRepresentationImage = imageIfAny(from->icon);
        item.showsCloseButton = from->showsButtons;
        break;
    }
    case BDTouchBarKindSegmentedControl: {
        NSSegmentedControl* control = view;
        NSDictionary<NSString*, NSNumber*>* styles = @{
            @"rounded" : @(NSSegmentStyleRounded), @"textured-rounded" : @(NSSegmentStyleTexturedRounded), @"round-rect" : @(NSSegmentStyleRoundRect),
            @"textured-square" : @(NSSegmentStyleTexturedSquare), @"capsule" : @(NSSegmentStyleCapsule),
            @"small-square" : @(NSSegmentStyleSmallSquare), @"separated" : @(NSSegmentStyleSeparated),
        };
        control.segmentStyle = styles[style].integerValue;
        control.trackingMode = [mode isEqual:@"multiple"] ? NSSegmentSwitchTrackingSelectAny
            : [mode isEqual:@"buttons"]                   ? NSSegmentSwitchTrackingMomentary
                                                          : NSSegmentSwitchTrackingSelectOne;
        control.segmentCount = from->children.length;
        forEach(it, from->children) {
            NSInteger at = it - from->children.start;
            [control setEnabled:it->isEnabled forSegment:at];
            [control setLabel:string(it->label) forSegment:at];
            [control setImage:imageIfAny(it->icon) forSegment:at];
            [control setImageScaling:NSImageScaleProportionallyUpOrDown forSegment:at];
        }
        if (from->value >= 0 && from->value < from->children.length)
            control.selectedSegment = from->value;
        break;
    }
    case BDTouchBarKindScrubber: {
        NSScrubber* scrubber = view;
        NSMutableArray *labels = [NSMutableArray new], *images = [NSMutableArray new];
        forEach(it, from->children) {
            [labels addObject:string(it->label)];
            [images addObject:imageIfAny(it->icon) ?: NSNull.null];
        }
        owner.labels = labels;
        owner.images = images;
        scrubber.showsArrowButtons = from->showsButtons;
        scrubber.selectionBackgroundStyle = selectionStyle(style);
        scrubber.selectionOverlayStyle = selectionStyle(string(from->overlayStyle));
        scrubber.mode = [mode isEqual:@"fixed"] ? NSScrubberModeFixed : NSScrubberModeFree;
        scrubber.continuous = from->isContinuous;
        [scrubber reloadData];
        break;
    }
    case BDTouchBarKindGroup:
    case BDTouchBarKindSpacer:
    case BDTouchBarKindOtherItems: break;
    }
}

static NSTouchBarItem* custom(NSString* name, NSView* view)
{
    NSCustomTouchBarItem* item = [[NSCustomTouchBarItem alloc] initWithIdentifier:name];
    item.view = view;
    return item;
}

static NSTouchBarItem* make(const BDTouchBarItem* from)
{
    NSString* name = [NSString stringWithFormat:@"sh.bun.desktop.%u", from->id];
    BunDesktopTouchItem* owner = [BunDesktopTouchItem new];
    NSTouchBarItem* item;
    switch (from->kind) {
    case BDTouchBarKindButton: item = custom(name, [NSButton buttonWithTitle:@"" target:owner action:@selector(clicked:)]); break;
    case BDTouchBarKindLabel: item = custom(name, [NSTextField labelWithString:@""]); break;
    case BDTouchBarKindSegmentedControl:
        item = custom(name, [NSSegmentedControl segmentedControlWithLabels:@[] trackingMode:NSSegmentSwitchTrackingSelectOne target:owner action:@selector(chose:)]);
        break;
    case BDTouchBarKindScrubber: {
        NSScrubber* scrubber = [[NSScrubber alloc] initWithFrame:NSMakeRect(0, 0, 320, 30)];
        [scrubber registerClass:NSScrubberTextItemView.class forItemIdentifier:@"text"];
        [scrubber registerClass:NSScrubberImageItemView.class forItemIdentifier:@"image"];
        scrubber.delegate = owner;
        scrubber.dataSource = owner;
        [scrubber.widthAnchor constraintEqualToConstant:320].active = YES;
        item = custom(name, scrubber);
        break;
    }
    case BDTouchBarKindColorPicker: {
        NSColorPickerTouchBarItem* picker = [[NSColorPickerTouchBarItem alloc] initWithIdentifier:name];
        picker.target = owner;
        picker.action = @selector(picked:);
        item = picker;
        break;
    }
    case BDTouchBarKindSlider: {
        NSSliderTouchBarItem* slider = [[NSSliderTouchBarItem alloc] initWithIdentifier:name];
        slider.target = owner;
        slider.action = @selector(slid:);
        item = slider;
        break;
    }
    case BDTouchBarKindPopover: {
        NSPopoverTouchBarItem* popover = [[NSPopoverTouchBarItem alloc] initWithIdentifier:name];
        popover.popoverTouchBar = barOf(from->children);
        item = popover;
        break;
    }
    case BDTouchBarKindGroup: {
        NSGroupTouchBarItem* group = [[NSGroupTouchBarItem alloc] initWithIdentifier:name];
        group.groupTouchBar = barOf(from->children);
        item = group;
        break;
    }
    case BDTouchBarKindSpacer:
    case BDTouchBarKindOtherItems: return nil;
    }
    owner.number = from->id;
    owner.item = item;
    objc_setAssociatedObject(item, @selector(item), owner, OBJC_ASSOCIATION_RETAIN);
    shown = shown ?: NSHashTable.weakObjectsHashTable;
    [shown addObject:owner];
    update(owner, from);
    return item;
}

static NSTouchBar* barOf(BDListTouchBarItem items)
{
    NSMutableArray* names = [NSMutableArray new];
    NSMutableSet* made = [NSMutableSet new];
    forEach(from, items) {
        NSTouchBarItem* item = make(from);
        NSString* size = string(from->style);
        if (item)
            [made addObject:item];
        [names addObject:item ? item.identifier
                : from->kind == BDTouchBarKindOtherItems ? NSTouchBarItemIdentifierOtherItemsProxy
                : [size isEqual:@"large"]                ? NSTouchBarItemIdentifierFixedSpaceLarge
                : [size isEqual:@"flexible"]             ? NSTouchBarItemIdentifierFlexibleSpace
                                                         : NSTouchBarItemIdentifierFixedSpaceSmall];
    }
    NSTouchBar* bar = [NSTouchBar new];
    bar.templateItems = made;
    bar.defaultItemIdentifiers = names;
    return bar;
}

NSTouchBar* touchBar(BDListTouchBarItem items, BDListTouchBarItem escape)
{
    NSTouchBar* bar = barOf(items);
    NSTouchBarItem* item = escape.length ? make(escape.start) : nil;
    if (item) {
        bar.templateItems = [bar.templateItems setByAddingObject:item];
        bar.escapeKeyReplacementItemIdentifier = item.identifier;
    }
    return items.length || item ? bar : nil;
}

void updateTouchBarItem(const BDTouchBarItem* from)
{
    for (BunDesktopTouchItem* owner in shown.allObjects)
        if (owner.number == from->id)
            update(owner, from);
}
