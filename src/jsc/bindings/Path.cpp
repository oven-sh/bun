// JSC glue for node:path. The implementation lives in src/runtime/node/path.rs and
// works directly on each JSString's Latin-1 / UTF-16 storage; these helpers hand it
// borrowed views of that storage and turn its results back into JSStrings.

#include "root.h"
#include "ZigGlobalObject.h"
#include "BunProcess.h"
#include "headers-handwritten.h"

#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSStringInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>

using namespace JSC;

// Mirrors `StringView` in src/runtime/node/path.rs.
struct PathStringView {
    const void* characters;
    uint32_t length;
    bool is16Bit;
};

static void fill(PathStringView* out, const GCOwnedDataScope<const String&>& data)
{
    const String& value = data;
    out->length = value.length();
    out->is16Bit = !value.is8Bit();
    out->characters = value.isNull() ? nullptr : value.is8Bit() ? static_cast<const void*>(value.span8().data())
                                                                : static_cast<const void*>(value.span16().data());
}

// Resolves `value` (a JSString) and exposes its characters. The view stays valid for as long
// as the JSString is reachable. Returns false with an exception pending on failure.
extern "C" bool Bun__Path__viewString(EncodedJSValue value, JSGlobalObject* globalObject, PathStringView* out)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSString* string = asString(JSValue::decode(value));
    auto resolved = string->value(globalObject);
    RETURN_IF_EXCEPTION(scope, false);
    fill(out, resolved);
    return true;
}

// process.cwd() as a resolved JSString plus a view of it, or {} with an exception pending.
extern "C" EncodedJSValue Bun__Path__cwd(JSGlobalObject* globalObject, PathStringView* out)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSString* cwd = defaultGlobalObject(globalObject)->processObject()->getCachedCwd(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto resolved = cwd->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    fill(out, resolved);
    return JSValue::encode(cwd);
}

// StringPrototypeSlice on a string previously passed through Bun__Path__viewString.
extern "C" EncodedJSValue Bun__Path__jsSubstring(JSGlobalObject* globalObject, EncodedJSValue value, uint32_t offset, uint32_t length)
{
    return JSValue::encode(jsSubstringOfResolved(globalObject->vm(), asString(JSValue::decode(value)), offset, length));
}

template<typename CharacterType>
static EncodedJSValue toJSString(VM& vm, std::span<const CharacterType> characters)
{
    if (characters.empty())
        return JSValue::encode(jsEmptyString(vm));
    if (characters.size() == 1 && characters[0] <= maxSingleCharacterString)
        return JSValue::encode(vm.smallStrings.singleCharacterString(characters[0]));
    return JSValue::encode(jsString(vm, String(StringImpl::create(characters))));
}

// The caller has checked `length <= String::MaxLength`.
extern "C" EncodedJSValue Bun__Path__jsStringLatin1(JSGlobalObject* globalObject, const Latin1Character* characters, size_t length)
{
    return toJSString(globalObject->vm(), std::span { characters, length });
}

extern "C" EncodedJSValue Bun__Path__jsStringUTF16(JSGlobalObject* globalObject, const char16_t* characters, size_t length)
{
    return toJSString(globalObject->vm(), std::span { characters, length });
}

// path.parse() result: { root, dir, base, ext, name } as slices [start, end) of `path`.
// A negative start denotes ''.
extern "C" EncodedJSValue Bun__Path__createParsed(JSGlobalObject* globalObject, EncodedJSValue path, const int32_t* ranges)
{
    auto& vm = globalObject->vm();
    JSString* string = asString(JSValue::decode(path));
    JSObject* result = constructEmptyObject(vm, defaultGlobalObject(globalObject)->pathParsedObjectStructure());
    for (unsigned i = 0; i < 5; ++i) {
        int32_t start = ranges[i * 2], end = ranges[i * 2 + 1];
        JSString* field = start < 0 ? jsEmptyString(vm) : jsSubstringOfResolved(vm, string, static_cast<unsigned>(start), static_cast<unsigned>(end - start));
        result->putDirectOffset(vm, i, field);
    }
    return JSValue::encode(result);
}

// StringPrototypeToLowerCase for the non-ASCII UTF-16 case of win32.relative().
extern "C" void Bun__Path__toLowerCase(const char16_t* characters, size_t length, BunString* result)
{
    *result = Bun::toStringRef(String({ characters, length }).convertToLowercaseWithoutLocale());
}
