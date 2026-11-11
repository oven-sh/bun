#include "V8RegExp.h"
#include "V8String.h"
#include "V8HandleScope.h"
#include "v8_compatibility_assertions.h"

#include <JavaScriptCore/RegExpObject.h>

ASSERT_V8_TYPE_LAYOUT_MATCHES(v8::RegExp)

ASSERT_V8_ENUM_MATCHES(RegExp::Flags, kNone)
ASSERT_V8_ENUM_MATCHES(RegExp::Flags, kGlobal)
ASSERT_V8_ENUM_MATCHES(RegExp::Flags, kIgnoreCase)
ASSERT_V8_ENUM_MATCHES(RegExp::Flags, kMultiline)
ASSERT_V8_ENUM_MATCHES(RegExp::Flags, kSticky)
ASSERT_V8_ENUM_MATCHES(RegExp::Flags, kUnicode)
ASSERT_V8_ENUM_MATCHES(RegExp::Flags, kDotAll)
ASSERT_V8_ENUM_MATCHES(RegExp::Flags, kLinear)
ASSERT_V8_ENUM_MATCHES(RegExp::Flags, kHasIndices)
ASSERT_V8_ENUM_MATCHES(RegExp::Flags, kUnicodeSets)
static_assert(v8::RegExp::kFlagCount == real_v8::RegExp::kFlagCount, "RegExp::kFlagCount does not match between Bun and V8");

namespace v8 {

Local<String> RegExp::GetSource() const
{
    auto* regExpObject = localToObjectPointer<JSC::RegExpObject>();
    RELEASE_ASSERT(regExpObject, "v8::RegExp::GetSource: not a RegExp");
    // The current isolate, not the RegExp's realm: a RegExp from a node:vm context has no V8 internals.
    Isolate* isolate = Isolate::GetCurrent();
    auto& vm = isolate->vm();
    auto* source = JSC::jsString(vm, regExpObject->regExp()->escapedPattern());
    return isolate->currentHandleScope()->createLocal<String>(vm, source);
}

RegExp::Flags RegExp::GetFlags() const
{
    auto* regExpObject = localToObjectPointer<JSC::RegExpObject>();
    RELEASE_ASSERT(regExpObject, "v8::RegExp::GetFlags: not a RegExp");
    JSC::RegExp* regExp = regExpObject->regExp();
    // The bit order differs from JSC's Yarr::Flags, so map each flag by name.
    int flags = kNone;
    if (regExp->global()) flags |= kGlobal;
    if (regExp->ignoreCase()) flags |= kIgnoreCase;
    if (regExp->multiline()) flags |= kMultiline;
    if (regExp->sticky()) flags |= kSticky;
    if (regExp->unicode()) flags |= kUnicode;
    if (regExp->dotAll()) flags |= kDotAll;
    if (regExp->hasIndices()) flags |= kHasIndices;
    if (regExp->unicodeSets()) flags |= kUnicodeSets;
    return static_cast<Flags>(flags);
}

} // namespace v8
