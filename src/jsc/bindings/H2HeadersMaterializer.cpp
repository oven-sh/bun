// Materializes a decoded HTTP/2 header block into JS values in a single
// native pass: the flat raw-headers array ([name1, value1, name2, value2, ...]),
// the node-shaped headers object (toHeaderObject semantics from node:http2),
// and the sensitive-names array. Replaces per-field JSArray::push round trips
// from the Rust engine sink with one call per block, and reuses WebCore's
// interned header-name strings so known header names allocate nothing.

#include "root.h"
#include "ZigGlobalObject.h"
#include "helpers.h"
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/JSCast.h>
#include <JavaScriptCore/Symbol.h>
#include <wtf/text/SymbolImpl.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringView.h>
#include "HTTPHeaderNames.h"
#include "wtf/SIMDUTF.h"

using namespace JSC;
using namespace WebCore;

namespace Bun {

// node:http2's kSingleValueHeaders: duplicate occurrences of these are
// dropped (first wins) instead of being comma-joined. Only consulted for
// duplicate names, so a comparison chain is fine.
static bool h2IsSingleValueHeader(WTF::StringView name)
{
    return name == ":status"_s || name == ":method"_s || name == ":authority"_s
        || name == ":scheme"_s || name == ":path"_s || name == ":protocol"_s
        || name == "access-control-allow-credentials"_s || name == "access-control-max-age"_s
        || name == "access-control-request-method"_s || name == "age"_s
        || name == "authorization"_s || name == "content-encoding"_s
        || name == "content-language"_s || name == "content-length"_s
        || name == "content-location"_s || name == "content-md5"_s
        || name == "content-range"_s || name == "content-type"_s
        || name == "date"_s || name == "dnt"_s || name == "etag"_s
        || name == "expires"_s || name == "from"_s || name == "host"_s
        || name == "if-match"_s || name == "if-modified-since"_s
        || name == "if-none-match"_s || name == "if-range"_s
        || name == "if-unmodified-since"_s || name == "last-modified"_s
        || name == "location"_s || name == "max-forwards"_s
        || name == "proxy-authorization"_s || name == "range"_s
        || name == "referer"_s || name == "retry-after"_s || name == "tk"_s
        || name == "upgrade-insecure-requests"_s || name == "user-agent"_s
        || name == "x-content-type-options"_s;
}

// Mirrors BunString__createUTF8ForJS: ASCII fast path, lossy UTF-8 otherwise.
static JSString* h2ValueToJS(VM& vm, const uint8_t* ptr, size_t length)
{
    if (length == 0)
        return jsEmptyString(vm);
    if (simdutf::validate_ascii(reinterpret_cast<const char*>(ptr), length))
        return jsString(vm, WTF::String(std::span<const Latin1Character>(reinterpret_cast<const Latin1Character*>(ptr), length)));
    auto str = WTF::String::fromUTF8ReplacingInvalidSequences(std::span { reinterpret_cast<const Latin1Character*>(ptr), length });
    if (str.isNull()) [[unlikely]]
        return nullptr;
    return jsString(vm, WTF::move(str));
}

// meta layout: per field, two u32s: [nameLen | (sensitive << 31), valueLen].
// packed layout: name bytes then value bytes, in field order.
// Returns [rawHeadersArray, headersObject, sensitiveArray | undefined], or 0
// with an exception pending.
extern "C" [[ZIG_EXPORT(zero_is_throw, no_user_js)]] JSC::EncodedJSValue Bun__h2__materializeHeaders(
    JSC::JSGlobalObject* globalObject,
    const uint8_t* packed,
    const uint32_t* meta,
    size_t fieldCount)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSC::JSArray* raw = JSC::constructEmptyArray(globalObject, nullptr, static_cast<unsigned>(fieldCount * 2));
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSObject* obj = JSC::constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSArray* sensitive = nullptr;

    size_t offset = 0;
    unsigned rawIndex = 0;
    for (size_t i = 0; i < fieldCount; i++) {
        const uint32_t packedNameLen = meta[i * 2];
        const bool isSensitive = (packedNameLen & 0x80000000u) != 0;
        const size_t nameLen = packedNameLen & 0x7fffffffu;
        const size_t valueLen = meta[i * 2 + 1];

        const uint8_t* nameBytes = packed + offset;
        offset += nameLen;
        const uint8_t* valueBytes = packed + offset;
        offset += valueLen;

        // Wire names are validated lowercase ASCII before they reach this point.
        WTF::StringView nameView(std::span<const Latin1Character>(reinterpret_cast<const Latin1Character*>(nameBytes), nameLen));

        JSString* nameStr;
        WebCore::HTTPHeaderName headerName;
        if (WebCore::findHTTPHeaderName(nameView, headerName)) {
            // Interned: no allocation, and the atom's hash is cached.
            nameStr = jsString(vm, WTF::String(WTF::httpHeaderNameStringImpl(headerName)));
        } else {
            nameStr = jsString(vm, nameView.toString());
        }

        JSString* valueStr = h2ValueToJS(vm, valueBytes, valueLen);
        if (!valueStr) [[unlikely]] {
            throwOutOfMemoryError(globalObject, scope);
            return {};
        }

        raw->putDirectIndex(globalObject, rawIndex++, nameStr);
        RETURN_IF_EXCEPTION(scope, {});
        raw->putDirectIndex(globalObject, rawIndex++, valueStr);
        RETURN_IF_EXCEPTION(scope, {});

        if (isSensitive) {
            if (!sensitive) {
                sensitive = JSC::constructEmptyArray(globalObject, nullptr, 0);
                RETURN_IF_EXCEPTION(scope, {});
            }
            sensitive->putDirectIndex(globalObject, sensitive->length(), nameStr);
            RETURN_IF_EXCEPTION(scope, {});
        }

        const String nameString = nameStr->getString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        const auto ident = Identifier::fromString(vm, nameString);

        JSValue fieldValue = valueStr;
        if (nameView == ":status"_s) {
            // toHeaderObject: `value |= 0` — exact ToInt32(ToNumber(string)).
            double num = valueStr->toNumber(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
            fieldValue = jsNumber(JSC::toInt32(num));
        }

        const bool isSetCookie = nameView == "set-cookie"_s;
        // All-digit header names ("123") are valid HTTP tokens. putDirect()
        // ASSERT(!parseIndex(propertyName)) trips in debug builds; route the
        // index-like case through *Index variants like NodeHTTP.cpp does.
        if (auto index = parseIndex(ident)) [[unlikely]] {
            JSValue existing = obj->getDirectIndex(globalObject, *index);
            RETURN_IF_EXCEPTION(scope, {});
            if (!existing) {
                obj->putDirectIndex(globalObject, *index, fieldValue);
                RETURN_IF_EXCEPTION(scope, {});
            }
            // No multi-value join for index-like names — set-cookie/cookie are
            // never numeric, and node's compat layer also takes first-wins for
            // duplicate index-like names.
            continue;
        }
        JSValue existing = obj->getDirect(vm, ident);
        if (!existing) {
            if (isSetCookie) {
                JSC::JSArray* arr = JSC::constructEmptyArray(globalObject, nullptr, 1);
                RETURN_IF_EXCEPTION(scope, {});
                arr->putDirectIndex(globalObject, 0, fieldValue);
                RETURN_IF_EXCEPTION(scope, {});
                obj->putDirect(vm, ident, arr, 0);
            } else {
                obj->putDirect(vm, ident, fieldValue, 0);
            }
        } else if (!h2IsSingleValueHeader(nameView)) {
            if (isSetCookie) {
                JSC::JSArray* arr = JSC::asArray(existing);
                arr->putDirectIndex(globalObject, arr->length(), fieldValue);
                RETURN_IF_EXCEPTION(scope, {});
            } else {
                // cookie joins with "; ", everything else with ", " (RFC 7230 §3.2.2).
                auto existingString = existing.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                auto valueString = valueStr->getString(globalObject);
                RETURN_IF_EXCEPTION(scope, {});
                auto joined = nameView == "cookie"_s
                    ? WTF::makeString(existingString, "; "_s, valueString)
                    : WTF::makeString(existingString, ", "_s, valueString);
                obj->putDirect(vm, ident, jsString(vm, WTF::move(joined)), 0);
            }
        }
    }

    // obj[Symbol.for("nodejs.http2.sensitiveHeaders")] = sensitive || []
    {
        JSValue sensitiveProp = sensitive;
        if (!sensitive) {
            sensitiveProp = JSC::constructEmptyArray(globalObject, nullptr, 0);
            RETURN_IF_EXCEPTION(scope, {});
        }
        auto symbolImpl = vm.symbolRegistry().symbolForKey("nodejs.http2.sensitiveHeaders"_s);
        obj->putDirect(vm, Identifier::fromUid(vm, &symbolImpl.get()), sensitiveProp, 0);
    }

    JSC::JSArray* tuple = JSC::constructEmptyArray(globalObject, nullptr, 3);
    RETURN_IF_EXCEPTION(scope, {});
    tuple->putDirectIndex(globalObject, 0, raw);
    RETURN_IF_EXCEPTION(scope, {});
    tuple->putDirectIndex(globalObject, 1, obj);
    RETURN_IF_EXCEPTION(scope, {});
    tuple->putDirectIndex(globalObject, 2, sensitive ? JSValue(sensitive) : jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(tuple);
}

} // namespace Bun
