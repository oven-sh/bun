#pragma once

#import <Foundation/Foundation.h>
#import <wtf/RetainPtr.h>
#import <wtf/text/WTFString.h>

// WTF::String::createNSString() and the String(NSString *) constructor only
// exist in the Cocoa builds of WTF; bun links the JSCOnly build, so the
// sources call these instead.

namespace WebGPU {

inline RetainPtr<NSString> createNSString(const String& string)
{
    if (string.isEmpty())
        return @"";
    if (string.is8Bit()) {
        auto characters = string.span8();
        return adoptNS([[NSString alloc] initWithBytes:characters.data() length:characters.size() encoding:NSISOLatin1StringEncoding]);
    }
    auto characters = string.span16();
    return adoptNS([[NSString alloc] initWithCharacters:reinterpret_cast<const unichar*>(characters.data()) length:characters.size()]);
}

inline String createString(NSString *string)
{
    if (!string)
        return { };
    std::span<char16_t> characters;
    auto result = String::createUninitialized(string.length, characters);
    if (!characters.empty())
        [string getCharacters:reinterpret_cast<unichar*>(characters.data()) range:NSMakeRange(0, characters.size())];
    return result;
}

} // namespace WebGPU
