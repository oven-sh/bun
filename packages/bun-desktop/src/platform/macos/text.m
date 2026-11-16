// For `text/core_text.rs`, on any thread. What is returned belongs to the caller.
#import "bridge.h"
#import <CoreText/CoreText.h>

/// A style sheet is no reason to show a dialog.
static const CTFontOptions withoutAsking = kCTFontOptionsPreventAutoActivation | kCTFontOptionsPreventAutoDownload;

static char* copyOf(CFTypeRef owned)
{
    @autoreleasepool {
        id value = CFBridgingRelease(owned);
        NSString* string = list(value) ? [value componentsJoinedByString:@"\n"] : [value isKindOfClass:NSURL.class] ? [value path] : value;
        return strdup(string.UTF8String ?: "");
    }
}

static CFStringRef createString(const char* string) { return CFStringCreateWithCString(NULL, string, kCFStringEncodingUTF8); }

void bd_retain(CFTypeRef object) { CFRetain(object); }

CTFontRef bd_font_named(const char* name)
{
    CFStringRef string = createString(name);
    CTFontRef font = CTFontCreateWithNameAndOptions(string, 12, NULL, withoutAsking);
    CFRelease(string);
    return font;
}

CTFontRef bd_font_of_system(void) { return CTFontCreateUIFontForLanguage(kCTFontUIFontSystem, 12, NULL); }

CTFontRef bd_font_with_traits(CTFontRef font, bool isBold, bool isItalic)
{
    CTFontSymbolicTraits traits = (isBold ? kCTFontTraitBold : 0) | (isItalic ? kCTFontTraitItalic : 0);
    return CTFontCreateCopyWithSymbolicTraits(font, 0, NULL, traits, traits);
}

/// One unit is one point.
CTFontRef bd_font_unscaled(CTFontRef font) { return CTFontCreateCopyWithAttributes(font, CTFontGetUnitsPerEm(font), NULL, NULL); }

CTFontRef bd_font_for_text(CTFontRef base, const char* characters, const char* language)
{
    CFStringRef string = createString(characters), tag = *language ? createString(language) : NULL;
    CTFontRef font = CTFontCreateForStringWithLanguage(base, string, CFRangeMake(0, CFStringGetLength(string)), tag);
    CFRelease(string);
    if (tag)
        CFRelease(tag);
    return font;
}

size_t bd_fonts_of_family(const char* family, CTFontRef* fonts, size_t capacity)
{
    @autoreleasepool {
        NSDictionary* attributes = @{ (id)kCTFontFamilyNameAttribute : @(family) };
        id wanted = CFBridgingRelease(CTFontDescriptorCreateWithAttributes((__bridge CFDictionaryRef)attributes));
        NSArray* found = CFBridgingRelease(CTFontDescriptorCreateMatchingFontDescriptors((__bridge CTFontDescriptorRef)wanted, NULL));
        size_t count = MIN(found.count, capacity);
        for (size_t index = 0; index < count; index++)
            fonts[index] = CTFontCreateWithFontDescriptorAndOptions((__bridge CTFontDescriptorRef)found[index], 12, NULL, withoutAsking);
        return count;
    }
}

/// One on each line.
char* bd_font_families(void) { return copyOf(CTFontManagerCopyAvailableFontFamilyNames()); }
char* bd_font_family_name(CTFontRef font) { return copyOf(CTFontCopyFamilyName(font)); }
char* bd_font_postscript_name(CTFontRef font) { return copyOf(CTFontCopyPostScriptName(font)); }
char* bd_font_full_name(CTFontRef font) { return copyOf(CTFontCopyFullName(font)); }
char* bd_font_path(CTFontRef font) { return copyOf(CTFontCopyAttribute(font, kCTFontURLAttribute)); }

double bd_font_weight(CTFontRef font)
{
    @autoreleasepool {
        NSDictionary* traits = CFBridgingRelease(CTFontCopyTraits(font));
        return number(traits[(id)kCTFontWeightTrait]).doubleValue;
    }
}

/// The bytes last until what is returned is released.
CFDataRef bd_font_table(CTFontRef font, uint32_t tag, const uint8_t** bytes, size_t* length)
{
    CFDataRef table = CTFontCopyTable(font, tag, kCTFontTableOptionNoOptions);
    if (table) {
        *bytes = CFDataGetBytePtr(table);
        *length = CFDataGetLength(table);
    }
    return table;
}

/// Move 0, line 1, quadratic curve 2, cubic curve 3, close 4.
void bd_font_outline(CTFontRef font, uint16_t glyph, double scale, void* pen, void (*add)(void* pen, int32_t kind, const CGPoint* points))
{
    CGAffineTransform matrix = CGAffineTransformMakeScale(scale, scale);
    CGPathRef path = CTFontCreatePathForGlyph(font, glyph, &matrix);
    if (path) {
        CGPathApplyWithBlock(path, ^(const CGPathElement* element) {
            add(pen, element->type, element->points);
        });
        CFRelease(path);
    }
}

CTFontRef bd_font_sized(CTFontRef font, double size) { return CTFontCreateCopyWithAttributes(font, size, NULL, NULL); }

BDRect bd_glyph_bounds(CTFontRef font, uint16_t glyph)
{
    CGRect bounds = CTFontGetBoundingRectsForGlyphs(font, kCTFontOrientationHorizontal, &glyph, NULL, 1);
    return (BDRect) { bounds.origin.x, bounds.origin.y, bounds.size.width, bounds.size.height };
}

/// Premultiplied RGBA. `y` is from the bottom.
void bd_glyph_draw(CTFontRef font, uint16_t glyph, double x, double y, void* pixels, size_t width, size_t height)
{
    CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    CGContextRef context = CGBitmapContextCreate(pixels, width, height, 8, width * 4, space, (CGBitmapInfo)kCGImageAlphaPremultipliedLast);
    CGColorSpaceRelease(space);
    if (context) {
        CGPoint position = { x, y };
        CTFontDrawGlyphs(font, &glyph, &position, 1, context);
        CGContextRelease(context);
    }
}
